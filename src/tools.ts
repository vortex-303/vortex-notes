/**
 * The agent tool set over a local vault — one implementation shared by the
 * stdio MCP server (src/mcp.ts) and the matching CLI commands (src/cli.ts),
 * so an agent gets the same behavior and text whichever way it connects.
 * Each tool returns the text an agent sees plus structured data for --json.
 */
import fs from "node:fs";
import path from "node:path";
import { Vault, slugify } from "./vault.js";
import { Indexer } from "./indexer.js";
import { search } from "./search.js";
import { buildContext } from "./context.js";
import { isLockedContent } from "./notelock.js";

export interface ToolResult {
  text: string;
  data: unknown;
}

export class VaultTools {
  constructor(
    readonly vault: Vault,
    readonly indexer: Indexer,
    private readonly readOnly = false,
    /** false for one-shot CLI calls: embeddings catch up on the next search */
    private readonly embedOnWrite = true,
    /** called after every successful write (the MCP server uses it to push soon) */
    private readonly onWrite?: (rel: string) => void
  ) {}

  private guardWrite(): void {
    if (this.readOnly) throw new Error("This vault is connected in read-only mode.");
  }

  private existing(rel: string): string {
    if (!fs.existsSync(this.vault.abs(rel))) throw new Error(`No such note: ${rel}. Use search_notes or list_notes to find the right path.`);
    return rel;
  }

  /** Keep the index fresh after a write; embeddings catch up in the background. */
  private touched(rel: string): void {
    this.indexer.indexNote(rel);
    if (this.embedOnWrite) void this.indexer.embedPending();
    this.onWrite?.(rel);
  }

  async searchNotes(query: string, limit = 8, mode: "hybrid" | "keyword" = "hybrid"): Promise<ToolResult> {
    const results = await search(this.indexer, query, limit, mode);
    const text = results.length
      ? results.map((r, i) => `${i + 1}. ${r.path}${r.heading ? ` › ${r.heading}` : ""} — ${r.title}\n${r.snippet}`).join("\n\n")
      : "No results.";
    return { text, data: results };
  }

  readNote(rel: string): ToolResult {
    const note = this.vault.readNote(this.existing(rel));
    const tags = note.tags.length ? ` | tags: ${note.tags.join(", ")}` : "";
    const locked = isLockedContent(note.body) || isLockedContent(`---\n---\n${note.body}`);
    const body = locked ? "[This note is password-protected. Its contents are encrypted and cannot be read here.]" : note.body;
    return {
      text: `# ${note.title}\npath: ${note.path}${tags}\n\n${body}`,
      data: { path: note.path, title: note.title, tags: note.tags, created: note.created, updated: note.updated, locked, body: locked ? null : note.body },
    };
  }

  writeNote(title: string, content: string, folder?: string, tags: string[] = []): ToolResult {
    this.guardWrite();
    const rel = path.posix.join(folder ?? "", slugify(title) + ".md");
    if (fs.existsSync(this.vault.abs(rel))) {
      throw new Error(`Note already exists: ${rel}. Use edit_note to modify it.`);
    }
    this.vault.writeNote(rel, title, content, tags);
    this.touched(rel);
    return { text: `Created ${rel}`, data: { path: rel } };
  }

  editNote(rel: string, operation: "append" | "prepend" | "find_replace", content: string, find?: string): ToolResult {
    this.guardWrite();
    const note = this.vault.readNote(this.existing(rel));
    let body: string;
    if (operation === "append") body = note.body.trimEnd() + "\n\n" + content.trim();
    else if (operation === "prepend") body = content.trim() + "\n\n" + note.body.trimStart();
    else {
      if (!find) throw new Error("find_replace requires 'find'");
      if (!note.body.includes(find)) throw new Error(`String not found in ${rel}: ${JSON.stringify(find.slice(0, 80))}`);
      body = note.body.replace(find, content);
    }
    this.vault.updateNote(rel, body);
    this.touched(rel);
    return { text: `Updated ${rel} (${operation})`, data: { path: rel, operation } };
  }

  appendDaily(content: string, date?: string): ToolResult {
    this.guardWrite();
    const rel = this.vault.appendDaily(content, date);
    this.touched(rel);
    return { text: `Appended to ${rel}`, data: { path: rel } };
  }

  async buildContext(topic: string, maxNotes = 4): Promise<ToolResult> {
    const text = await buildContext(this.indexer, topic, maxNotes);
    return { text, data: { topic, context: text } };
  }

  remember(fact: string, topic?: string, supersedes?: string): ToolResult {
    this.guardWrite();
    const r = this.vault.rememberFact(fact, topic, supersedes);
    this.touched(r.rel);
    return {
      text: `Recorded ^${r.id} in ${r.rel}${r.superseded ? ` (supersedes ^${r.superseded})` : ""}`,
      data: { path: r.rel, id: r.id, superseded: r.superseded ?? null },
    };
  }

  recentActivity(days = 7, limit = 20): ToolResult {
    const cutoff = Date.now() - days * 86400_000;
    const rows = this.indexer.db
      .prepare("SELECT path, title, mtime FROM notes WHERE mtime > ? ORDER BY mtime DESC LIMIT ?")
      .all(cutoff, limit) as { path: string; title: string; mtime: number }[];
    const text = rows.length
      ? rows.map((r) => `${new Date(r.mtime).toISOString().slice(0, 16)}  ${r.path} — ${r.title}`).join("\n")
      : "No notes modified in that window.";
    return { text, data: rows.map((r) => ({ path: r.path, title: r.title, modified: new Date(r.mtime).toISOString() })) };
  }

  listNotes(folder?: string, limit = 200): ToolResult {
    let paths = this.vault.listNoteFiles();
    if (folder) {
      const prefix = folder.replace(/\/+$/, "") + "/";
      paths = paths.filter((p) => p.startsWith(prefix));
    }
    paths = paths.slice(0, limit);
    return { text: paths.length ? paths.join("\n") : "No notes found.", data: paths };
  }
}
