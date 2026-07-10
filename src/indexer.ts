import fs from "node:fs";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { Vault, titleFromPath } from "./vault.js";
import { EMBED_DIM, embedPassages, isSemanticDisabled } from "./embeddings.js";

const SCHEMA_VERSION = "1";

export interface Chunk {
  text: string;
  heading: string;
  pos: number;
}

export class Indexer {
  readonly vault: Vault;
  readonly db: Database.Database;
  private vecAvailable = false;

  constructor(vault: Vault) {
    this.vault = vault;
    fs.mkdirSync(vault.metaDir, { recursive: true });
    this.db = new Database(vault.dbPath);
    this.db.pragma("journal_mode = WAL");
    try {
      sqliteVec.load(this.db);
      this.vecAvailable = true;
    } catch (err) {
      console.error(`[vortex-notes] sqlite-vec unavailable (${(err as Error).message}); vector search disabled`);
    }
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS notes (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL,
        updated TEXT
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
        heading TEXT NOT NULL DEFAULT '',
        pos INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedded INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
        text, heading, path UNINDEXED,
        content='chunks', content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
    if (this.vecAvailable) {
      this.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${EMBED_DIM}]);`
      );
    }
    const ver = this.db.prepare("SELECT value FROM meta WHERE key='schema'").get() as
      | { value: string }
      | undefined;
    if (!ver) {
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?)").run(SCHEMA_VERSION);
    }
  }

  /** Sync the index with the vault. Returns number of notes (re)indexed. */
  async indexAll(): Promise<{ indexed: number; removed: number; total: number }> {
    const onDisk = this.vault.listNoteFiles();
    const onDiskSet = new Set(onDisk);
    const known = this.db.prepare("SELECT path, mtime, size FROM notes").all() as {
      path: string;
      mtime: number;
      size: number;
    }[];

    let removed = 0;
    for (const row of known) {
      if (!onDiskSet.has(row.path)) {
        this.removeNote(row.path);
        removed++;
      }
    }

    const knownMap = new Map(known.map((r) => [r.path, r]));
    let indexed = 0;
    for (const rel of onDisk) {
      const stat = fs.statSync(this.vault.abs(rel));
      const prev = knownMap.get(rel);
      if (prev && prev.mtime === Math.floor(stat.mtimeMs) && prev.size === stat.size) continue;
      this.indexNote(rel, Math.floor(stat.mtimeMs), stat.size);
      indexed++;
    }

    await this.embedPending();
    return { indexed, removed, total: onDisk.length };
  }

  /** Index or reindex a single note (chunks + FTS). Embeddings are done in embedPending(). */
  indexNote(rel: string, mtime?: number, size?: number): void {
    const abs = this.vault.abs(rel);
    if (!fs.existsSync(abs)) {
      this.removeNote(rel);
      return;
    }
    const stat = fs.statSync(abs);
    const note = this.vault.readNote(rel);
    const chunks = chunkMarkdown(note.body);

    const tx = this.db.transaction(() => {
      this.deleteChunks(rel);
      this.db
        .prepare(
          `INSERT INTO notes (path, title, tags, mtime, size, updated)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             title=excluded.title, tags=excluded.tags, mtime=excluded.mtime,
             size=excluded.size, updated=excluded.updated`
        )
        .run(
          rel,
          note.title || titleFromPath(rel),
          JSON.stringify(note.tags),
          mtime ?? Math.floor(stat.mtimeMs),
          size ?? stat.size,
          note.updated ?? new Date(stat.mtimeMs).toISOString()
        );
      const insChunk = this.db.prepare(
        "INSERT INTO chunks (path, heading, pos, text) VALUES (?, ?, ?, ?)"
      );
      const insFts = this.db.prepare(
        "INSERT INTO fts_chunks (rowid, text, heading, path) VALUES (?, ?, ?, ?)"
      );
      for (const c of chunks) {
        const { lastInsertRowid } = insChunk.run(rel, c.heading, c.pos, c.text);
        insFts.run(lastInsertRowid, c.text, c.heading, rel);
      }
    });
    tx();
  }

  removeNote(rel: string): void {
    const tx = this.db.transaction(() => {
      this.deleteChunks(rel);
      this.db.prepare("DELETE FROM notes WHERE path=?").run(rel);
    });
    tx();
  }

  private deleteChunks(rel: string): void {
    const ids = this.db.prepare("SELECT id FROM chunks WHERE path=?").all(rel) as { id: number }[];
    const delFts = this.db.prepare("DELETE FROM fts_chunks WHERE rowid=?");
    const delVec = this.vecAvailable ? this.db.prepare("DELETE FROM vec_chunks WHERE rowid=?") : null;
    for (const { id } of ids) {
      delFts.run(id);
      delVec?.run(id);
    }
    this.db.prepare("DELETE FROM chunks WHERE path=?").run(rel);
  }

  /** Embed chunks that don't have vectors yet (batched). */
  async embedPending(): Promise<number> {
    if (!this.vecAvailable || isSemanticDisabled()) return 0;
    const model = this.vault.config().embedModel;
    let done = 0;
    for (;;) {
      const pending = this.db
        .prepare("SELECT id, heading, text FROM chunks WHERE embedded=0 LIMIT 32")
        .all() as { id: number; heading: string; text: string }[];
      if (!pending.length) break;
      const vectors = await embedPassages(
        model,
        pending.map((c) => (c.heading ? c.heading + "\n" : "") + c.text)
      );
      if (!vectors) return done; // model unavailable — keyword search still works
      const insVec = this.db.prepare("INSERT OR REPLACE INTO vec_chunks (rowid, embedding) VALUES (?, ?)");
      const markDone = this.db.prepare("UPDATE chunks SET embedded=1 WHERE id=?");
      const tx = this.db.transaction(() => {
        for (let i = 0; i < pending.length; i++) {
          insVec.run(BigInt(pending[i].id), Buffer.from(vectors[i].buffer, vectors[i].byteOffset, vectors[i].byteLength));
          markDone.run(pending[i].id);
        }
      });
      tx();
      done += pending.length;
    }
    return done;
  }

  get hasVectors(): boolean {
    return this.vecAvailable;
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Split markdown into ~1200-char chunks along heading/paragraph boundaries,
 * with heading context carried on each chunk.
 */
export function chunkMarkdown(body: string, maxLen = 1200): Chunk[] {
  const chunks: Chunk[] = [];
  let heading = "";
  let buf: string[] = [];
  let bufLen = 0;
  let pos = 0;

  const flush = () => {
    const text = buf.join("\n\n").trim();
    if (text) chunks.push({ text, heading, pos: pos++ });
    buf = [];
    bufLen = 0;
  };

  for (const block of body.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (h && trimmed.split("\n").length === 1) {
      flush();
      heading = h[2].trim();
      continue;
    }
    if (bufLen + trimmed.length > maxLen && bufLen > 0) flush();
    if (trimmed.length > maxLen) {
      // Oversized block: hard-split.
      flush();
      for (let i = 0; i < trimmed.length; i += maxLen) {
        buf = [trimmed.slice(i, i + maxLen + 200)];
        bufLen = buf[0].length;
        flush();
      }
      continue;
    }
    buf.push(trimmed);
    bufLen += trimmed.length;
  }
  flush();
  return chunks;
}
