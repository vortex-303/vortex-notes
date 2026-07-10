import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import matter from "gray-matter";
import { ulid } from "ulid";

export interface VaultConfig {
  semantic: boolean;
  embedModel: string;
}

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

const DEFAULT_CONFIG: VaultConfig = {
  semantic: true,
  embedModel: "Xenova/multilingual-e5-small",
};

export class Vault {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  static resolve(explicit?: string): Vault {
    const root =
      explicit ??
      process.env.VORTEX_NOTES_VAULT ??
      (fs.existsSync(path.join(process.cwd(), ".vortex"))
        ? process.cwd()
        : path.join(os.homedir(), "VortexNotes"));
    return new Vault(root);
  }

  get metaDir(): string {
    return path.join(this.root, ".vortex");
  }

  get dbPath(): string {
    return path.join(this.metaDir, "index.db");
  }

  get configPath(): string {
    return path.join(this.metaDir, "config.json");
  }

  exists(): boolean {
    return fs.existsSync(this.metaDir);
  }

  init(): void {
    fs.mkdirSync(this.metaDir, { recursive: true });
    fs.mkdirSync(path.join(this.root, "daily"), { recursive: true });
    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(this.configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    }
    const welcome = path.join(this.root, "Welcome.md");
    if (!fs.existsSync(welcome)) {
      this.writeNote("Welcome.md", "Welcome to Vortex Notes", WELCOME_BODY, ["vortex-notes"]);
    }
  }

  config(): VaultConfig {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(this.configPath, "utf8")) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  /** Resolve a vault-relative path safely; rejects escapes outside the vault. */
  abs(rel: string): string {
    const resolved = path.resolve(this.root, rel);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`Path escapes the vault: ${rel}`);
    }
    return resolved;
  }

  rel(absPath: string): string {
    return path.relative(this.root, absPath).split(path.sep).join("/");
  }

  isNotePath(rel: string): boolean {
    return rel.endsWith(".md") && !rel.split("/").some((p) => p.startsWith("."));
  }

  /** All markdown note paths (vault-relative), skipping dot-directories. */
  listNoteFiles(dir = this.root): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...this.listNoteFiles(full));
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(this.rel(full));
    }
    return out.sort();
  }

  readNote(rel: string): NoteFile {
    const raw = fs.readFileSync(this.abs(rel), "utf8");
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

  writeNote(rel: string, title: string, body: string, tags: string[] = []): string {
    const abs = this.abs(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const now = new Date().toISOString();
    const fm: Record<string, unknown> = {
      id: ulid(),
      title,
      created: now,
      updated: now,
    };
    if (tags.length) fm.tags = tags;
    fs.writeFileSync(abs, matter.stringify(body.trim() + "\n", fm));
    return rel;
  }

  /** Update body, preserving frontmatter and bumping `updated`. */
  updateNote(rel: string, newBody: string): void {
    const abs = this.abs(rel);
    const parsed = matter(fs.readFileSync(abs, "utf8"));
    const fm = { ...parsed.data, updated: new Date().toISOString() };
    fs.writeFileSync(abs, matter.stringify(newBody.trim() + "\n", fm));
  }

  dailyPath(date?: string): string {
    const day = date ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid date: ${date} (expected YYYY-MM-DD)`);
    return `daily/${day}.md`;
  }

  appendDaily(content: string, date?: string): string {
    const rel = this.dailyPath(date);
    const abs = this.abs(rel);
    const stamp = new Date().toISOString().slice(11, 16);
    const entry = `- **${stamp}** ${content.trim()}\n`;
    if (!fs.existsSync(abs)) {
      const day = rel.slice(6, 16);
      this.writeNote(rel, day, entry, ["daily"]);
    } else {
      const note = this.readNote(rel);
      this.updateNote(rel, note.body.trimEnd() + "\n" + entry);
    }
    return rel;
  }
}

export function titleFromPath(rel: string, body?: string): string {
  const h1 = body?.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const base = rel.split("/").pop() ?? rel;
  return base.replace(/\.md$/, "");
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "note"
  );
}

const WELCOME_BODY = `# Welcome to Vortex Notes

This folder is a plain-markdown vault. Every file here is yours — open it in any
editor, sync it with any tool, grep it, git it.

What makes it different: a first-party **MCP server** so AI agents (Claude Code,
OpenClaw, Cursor, anything MCP-compatible) can search, read, and write these
notes with your permission — plus zero-config **local semantic search** that
never sends a byte to any API.

## Quick start

- \`vortex-notes mcp\` — start the MCP server (stdio) for this vault
- \`vortex-notes search "your query"\` — hybrid keyword + semantic search
- \`vortex-notes index\` — (re)build the search index

Daily notes live in \`daily/YYYY-MM-DD.md\`. Agents append there via the
\`append_daily\` tool; you can too.
`;
