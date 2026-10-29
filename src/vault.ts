import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { titleFromPath, slugify } from "./textutil.js";
import { NoteOps, parseNote, type NoteFile } from "./notes.js";

export { titleFromPath, slugify };
export type { NoteFile };

export interface VaultConfig {
  semantic: boolean;
  embedModel: string;
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
    // MCP configs launch us without a shell, so a "~/..." path arrives unexpanded.
    const expand = (p?: string) => (p && (p === "~" || p.startsWith("~/")) ? path.join(os.homedir(), p.slice(1)) : p);
    const root =
      expand(explicit) ||
      expand(process.env.VORTEX_NOTES_VAULT) || // empty = unset
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

  /** Formatting rules live in NoteOps (shared with the relay's hosted MCP). */
  private get ops(): NoteOps {
    return new NoteOps({
      read: (rel) => (fs.existsSync(this.abs(rel)) ? fs.readFileSync(this.abs(rel), "utf8") : null),
      write: (rel, raw) => {
        fs.mkdirSync(path.dirname(this.abs(rel)), { recursive: true });
        fs.writeFileSync(this.abs(rel), raw);
      },
    });
  }

  readNote(rel: string): NoteFile {
    return parseNote(rel, fs.readFileSync(this.abs(rel), "utf8"));
  }

  writeNote(rel: string, title: string, body: string, tags: string[] = []): string {
    return this.ops.writeNote(rel, title, body, tags);
  }

  /** Update body, preserving frontmatter and bumping `updated`. */
  updateNote(rel: string, newBody: string): void {
    this.ops.updateNote(rel, newBody);
  }

  dailyPath(date?: string): string {
    return this.ops.dailyPath(date);
  }

  /** Dated fact in memory/<topic>.md; supersession keeps the old line, struck through. */
  rememberFact(fact: string, topic?: string, supersedes?: string): { rel: string; id: string; superseded?: string } {
    return this.ops.rememberFact(fact, topic, supersedes);
  }

  /** True if Welcome.md is still the untouched auto-generated starter note. */
  isPristineWelcome(): boolean {
    try {
      return this.readNote("Welcome.md").body.trim() === WELCOME_BODY.trim();
    } catch {
      return false;
    }
  }

  appendDaily(content: string, date?: string): string {
    return this.ops.appendDaily(content, date);
  }
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
