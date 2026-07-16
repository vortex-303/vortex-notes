import fs from "node:fs";
import { sep as pathSep } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { Vault, titleFromPath } from "./vault.js";
import { EMBED_DIM, embedPassages, isSemanticDisabled } from "./embeddings.js";
import { isLockedContent } from "./notelock.js";

const SCHEMA_VERSION = "2";

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
    this.db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`);
    const ver = this.db.prepare("SELECT value FROM meta WHERE key='schema'").get() as
      | { value: string }
      | undefined;
    if (ver && ver.value !== SCHEMA_VERSION) {
      // Index is a disposable cache — on schema change, rebuild from the vault.
      console.error(`[vortex-notes] index schema ${ver.value} → ${SCHEMA_VERSION}, rebuilding index`);
      this.db.exec(`
        DROP TABLE IF EXISTS fts_chunks;
        DROP TABLE IF EXISTS vec_chunks;
        DROP TABLE IF EXISTS links;
        DROP TABLE IF EXISTS chunks;
        DROP TABLE IF EXISTS notes;
      `);
    }
    this.db.exec(`
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
      CREATE TABLE IF NOT EXISTS links (
        from_path TEXT NOT NULL,
        target TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS links_from ON links(from_path);
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
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)")
      .run(SCHEMA_VERSION);
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
    // Password-locked notes: index the title only, never the ciphertext body.
    const chunks = isLockedContent(`---\n---\n${note.body}`) ? [] : chunkMarkdown(note.body);

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
        // Title stands in as heading context so titles are searchable too.
        const heading = c.heading || note.title;
        const { lastInsertRowid } = insChunk.run(rel, heading, c.pos, c.text);
        insFts.run(lastInsertRowid, c.text, heading, rel);
      }
      const insLink = this.db.prepare("INSERT INTO links (from_path, target) VALUES (?, ?)");
      for (const target of extractWikilinks(note.body)) insLink.run(rel, target);
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
    this.db.prepare("DELETE FROM links WHERE from_path=?").run(rel);
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
 * Watch the vault and reindex changed notes (debounced). onChange fires after
 * reindex. Returns a handle whose close() releases the watcher — without it,
 * the process never exits (chokidar keeps the event loop alive).
 */
export function startVaultWatcher(
  vault: Vault,
  indexer: Indexer,
  onChange?: (rel: string) => void
): { close: () => Promise<void> } {
  let watcher: { close: () => Promise<void> } | null = null;
  let closed = false;
  const timers = new Map<string, NodeJS.Timeout>();
  void import("chokidar").then(({ default: chokidar }) => {
    if (closed) return;
    watcher = chokidar
      .watch(vault.root, {
        ignored: (p: string) => p.split(pathSep).some((seg) => seg.startsWith(".")),
        ignoreInitial: true,
      })
      .on("all", (_event: string, absPath: string) => {
        if (!absPath.endsWith(".md")) return;
        const rel = vault.rel(absPath);
        if (!vault.isNotePath(rel)) return;
        clearTimeout(timers.get(rel));
        timers.set(
          rel,
          setTimeout(() => {
            timers.delete(rel);
            try {
              indexer.indexNote(rel);
              void indexer.embedPending();
              onChange?.(rel);
            } catch (err) {
              console.error(`[vortex-notes] reindex failed for ${rel}: ${(err as Error).message}`);
            }
          }, 400)
        );
      });
  });
  return {
    close: async () => {
      closed = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      await watcher?.close();
    },
  };
}

/** Extract [[wikilink]] targets, ignoring #heading fragments and |aliases. */
export function extractWikilinks(body: string): string[] {
  const targets = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\][|#]+)(?:#[^\][|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const t = m[1].trim();
    if (t) targets.add(t);
  }
  return [...targets];
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
