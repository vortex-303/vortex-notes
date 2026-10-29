/**
 * Note formatting and mutation rules (frontmatter, daily notes, remembered
 * facts) over any storage: the on-disk Vault and the relay's hosted MCP
 * connector both use these, so a note looks the same however it was written.
 */
import matter from "gray-matter";
import { ulid } from "ulid";
import { titleFromPath, slugify } from "./textutil.js";

export interface NoteFile {
  /** vault-relative path, always with forward slashes */
  path: string;
  title: string;
  tags: string[];
  created?: string;
  updated?: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface NoteBackend {
  /** Raw file text, or null if the note doesn't exist. */
  read(rel: string): string | null;
  write(rel: string, raw: string): void;
}

export function parseNote(rel: string, raw: string): NoteFile {
  const parsed = matter(raw);
  const fm = parsed.data ?? {};
  return {
    path: rel,
    title: typeof fm.title === "string" ? fm.title : titleFromPath(rel, parsed.content),
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    created: fm.created ? String(fm.created) : undefined,
    updated: fm.updated ? String(fm.updated) : undefined,
    body: parsed.content,
    frontmatter: fm,
  };
}

export class NoteOps {
  constructor(private readonly store: NoteBackend) {}

  readNote(rel: string): NoteFile {
    const raw = this.store.read(rel);
    if (raw === null) throw new Error(`No such note: ${rel}`);
    return parseNote(rel, raw);
  }

  exists(rel: string): boolean {
    return this.store.read(rel) !== null;
  }

  writeNote(rel: string, title: string, body: string, tags: string[] = []): string {
    const now = new Date().toISOString();
    const fm: Record<string, unknown> = {
      id: ulid(),
      title,
      created: now,
      updated: now,
    };
    if (tags.length) fm.tags = tags;
    this.store.write(rel, matter.stringify(body.trim() + "\n", fm));
    return rel;
  }

  /** Update body, preserving frontmatter and bumping `updated`. */
  updateNote(rel: string, newBody: string): void {
    const raw = this.store.read(rel);
    if (raw === null) throw new Error(`No such note: ${rel}`);
    const parsed = matter(raw);
    const fm = { ...parsed.data, updated: new Date().toISOString() };
    this.store.write(rel, matter.stringify(newBody.trim() + "\n", fm));
  }

  dailyPath(date?: string): string {
    const day = date ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid date: ${date} (expected YYYY-MM-DD)`);
    return `daily/${day}.md`;
  }

  /**
   * Record a durable fact as a dated bullet in memory/<topic>.md. When it
   * supersedes an earlier fact, the old line stays visible with strikethrough
   * and a pointer to the new fact's id — history is never silently erased.
   */
  rememberFact(fact: string, topic?: string, supersedes?: string): { rel: string; id: string; superseded?: string } {
    const rel = `memory/${topic ? slugify(topic) : "facts"}.md`;
    const id = "f-" + ulid().slice(-8).toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const line = `- **${today}** ${fact.trim().replace(/\n+/g, " ")} \`^${id}\``;

    if (!this.exists(rel)) {
      if (supersedes) throw new Error(`No facts recorded yet under ${rel}; nothing to supersede.`);
      this.writeNote(rel, topic ? `Facts — ${topic}` : "Facts", line, ["memory"]);
      return { rel, id };
    }

    const note = this.readNote(rel);
    let body = note.body;
    let superseded: string | undefined;
    if (supersedes) {
      const key = supersedes.replace(/^\^/, "").trim();
      const lines = body.split("\n");
      const byId = (l: string) => l.includes(`^${key}\``);
      const byText = (l: string) =>
        l.startsWith("- ") && !l.includes("~~") && l.toLowerCase().includes(key.toLowerCase());
      const idx = lines.findIndex(key.startsWith("f-") ? byId : (l) => byId(l) || byText(l));
      if (idx === -1) {
        throw new Error(
          `No fact matching "${supersedes}" in ${rel}. Pass the fact's ^id or a distinctive substring.`
        );
      }
      const old = lines[idx];
      if (old.includes("~~")) throw new Error(`That fact is already superseded: ${old.trim()}`);
      lines[idx] = `- ~~${old.replace(/^-\s*/, "")}~~ → superseded ${today} by \`^${id}\``;
      body = lines.join("\n");
      superseded = old.match(/\^(f-[a-z0-9]+)/)?.[1];
    }
    this.updateNote(rel, body.trimEnd() + "\n" + line);
    return { rel, id, superseded };
  }

  appendDaily(content: string, date?: string): string {
    const rel = this.dailyPath(date);
    const stamp = new Date().toISOString().slice(11, 16);
    const entry = `- **${stamp}** ${content.trim()}\n`;
    if (!this.exists(rel)) {
      const day = rel.slice(6, 16);
      this.writeNote(rel, day, entry, ["daily"]);
    } else {
      const note = this.readNote(rel);
      this.updateNote(rel, note.body.trimEnd() + "\n" + entry);
    }
    return rel;
  }
}
