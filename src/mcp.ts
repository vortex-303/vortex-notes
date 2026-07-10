import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Vault, slugify } from "./vault.js";
import { Indexer, startVaultWatcher } from "./indexer.js";
import { search } from "./search.js";
import { buildContext } from "./context.js";

export interface McpOptions {
  readOnly: boolean;
  watch: boolean;
}

export async function startMcpServer(vault: Vault, opts: McpOptions): Promise<void> {
  if (!vault.exists()) vault.init();
  const indexer = new Indexer(vault);

  // Initial index sync in the background so the server is responsive immediately.
  void indexer.indexAll().then(
    (r) => console.error(`[vortex-notes] index ready: ${r.total} notes (${r.indexed} refreshed)`),
    (err) => console.error(`[vortex-notes] index error: ${err.message}`)
  );

  if (opts.watch) startVaultWatcher(vault, indexer);

  const server = new McpServer({ name: "vortex-notes", version: "0.1.0" });
  const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
  const guardWrite = () => {
    if (opts.readOnly) throw new Error("This vault is connected in read-only mode.");
  };

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Search the vault with hybrid keyword + semantic search. Returns note paths, headings, and snippets. Use read_note for full content.",
      inputSchema: {
        query: z.string().describe("Natural-language or keyword query"),
        limit: z.number().int().min(1).max(25).optional().describe("Max results (default 8)"),
        mode: z.enum(["hybrid", "keyword"]).optional().describe("Search mode (default hybrid)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit, mode }) => {
      const results = await search(indexer, query, limit ?? 8, mode ?? "hybrid");
      if (!results.length) return text("No results.");
      return text(
        results
          .map(
            (r, i) =>
              `${i + 1}. ${r.path}${r.heading ? ` › ${r.heading}` : ""} — ${r.title}\n${r.snippet}`
          )
          .join("\n\n")
      );
    }
  );

  server.registerTool(
    "read_note",
    {
      title: "Read note",
      description: "Read a note's full markdown content by vault-relative path.",
      inputSchema: { path: z.string().describe("Vault-relative path, e.g. 'projects/idea.md'") },
      annotations: { readOnlyHint: true },
    },
    async ({ path: rel }) => {
      const note = vault.readNote(rel);
      const tags = note.tags.length ? ` | tags: ${note.tags.join(", ")}` : "";
      return text(`# ${note.title}\npath: ${note.path}${tags}\n\n${note.body}`);
    }
  );

  server.registerTool(
    "write_note",
    {
      title: "Create note",
      description:
        "Create a new markdown note. Fails if the path already exists — use edit_note to modify existing notes.",
      inputSchema: {
        title: z.string().describe("Note title"),
        content: z.string().describe("Markdown body"),
        folder: z.string().optional().describe("Optional vault-relative folder, e.g. 'projects'"),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ title, content, folder, tags }) => {
      guardWrite();
      const rel = path.posix.join(folder ?? "", slugify(title) + ".md");
      if (fs.existsSync(vault.abs(rel))) {
        throw new Error(`Note already exists: ${rel}. Use edit_note to modify it.`);
      }
      vault.writeNote(rel, title, content, tags ?? []);
      indexer.indexNote(rel);
      void indexer.embedPending();
      return text(`Created ${rel}`);
    }
  );

  server.registerTool(
    "edit_note",
    {
      title: "Edit note",
      description:
        "Edit an existing note surgically: append, prepend, or find_replace (exact string). Prefer this over rewriting whole notes.",
      inputSchema: {
        path: z.string().describe("Vault-relative path"),
        operation: z.enum(["append", "prepend", "find_replace"]),
        content: z.string().describe("Text to append/prepend, or replacement text for find_replace"),
        find: z.string().optional().describe("Exact string to find (find_replace only)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ path: rel, operation, content, find }) => {
      guardWrite();
      const note = vault.readNote(rel);
      let body: string;
      if (operation === "append") body = note.body.trimEnd() + "\n\n" + content.trim();
      else if (operation === "prepend") body = content.trim() + "\n\n" + note.body.trimStart();
      else {
        if (!find) throw new Error("find_replace requires 'find'");
        if (!note.body.includes(find)) throw new Error(`String not found in ${rel}: ${JSON.stringify(find.slice(0, 80))}`);
        body = note.body.replace(find, content);
      }
      vault.updateNote(rel, body);
      indexer.indexNote(rel);
      void indexer.embedPending();
      return text(`Updated ${rel} (${operation})`);
    }
  );

  server.registerTool(
    "append_daily",
    {
      title: "Append to daily note",
      description:
        "Append a timestamped entry to today's daily note (or a given date). The right place for observations, decisions, and things to remember.",
      inputSchema: {
        content: z.string().describe("Markdown for the entry (one bullet)"),
        date: z.string().optional().describe("YYYY-MM-DD (default: today)"),
      },
    },
    async ({ content, date }) => {
      guardWrite();
      const rel = vault.appendDaily(content, date);
      indexer.indexNote(rel);
      void indexer.embedPending();
      return text(`Appended to ${rel}`);
    }
  );

  server.registerTool(
    "build_context",
    {
      title: "Build context",
      description:
        "Load working context for a topic in one call: full content of the top-matching notes plus one hop of [[wikilinked]] notes as pointers. Prefer this over multiple search+read rounds when starting work on a topic.",
      inputSchema: {
        topic: z.string().describe("Topic, question, or entity to build context for"),
        max_notes: z.number().int().min(1).max(10).optional().describe("Primary notes to include in full (default 4)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ topic, max_notes }) => text(await buildContext(indexer, topic, max_notes ?? 4))
  );

  server.registerTool(
    "remember",
    {
      title: "Remember a fact",
      description:
        "Record a durable fact in the shared memory (memory/*.md) as a dated bullet with a stable ^id. If it replaces an earlier fact, pass supersedes (the old fact's ^id, or a distinctive substring of it) — the old fact stays visible with strikethrough and a pointer to the new one. Use search_notes to find existing facts first.",
      inputSchema: {
        fact: z.string().describe("The fact, stated so it makes sense without conversation context"),
        topic: z.string().optional().describe("Optional topic — facts go to memory/<topic>.md instead of memory/facts.md"),
        supersedes: z.string().optional().describe("^id or distinctive substring of the fact this replaces"),
      },
    },
    async ({ fact, topic, supersedes }) => {
      guardWrite();
      const r = vault.rememberFact(fact, topic, supersedes);
      indexer.indexNote(r.rel);
      void indexer.embedPending();
      return text(
        `Recorded ^${r.id} in ${r.rel}${r.superseded ? ` (supersedes ^${r.superseded})` : ""}`
      );
    }
  );

  server.registerTool(
    "recent_activity",
    {
      title: "Recent activity",
      description: "List notes modified in the last N days, newest first.",
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe("Lookback window (default 7)"),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ days, limit }) => {
      const cutoff = Date.now() - (days ?? 7) * 86400_000;
      const rows = indexer.db
        .prepare("SELECT path, title, mtime FROM notes WHERE mtime > ? ORDER BY mtime DESC LIMIT ?")
        .all(cutoff, limit ?? 20) as { path: string; title: string; mtime: number }[];
      if (!rows.length) return text("No notes modified in that window.");
      return text(
        rows
          .map((r) => `${new Date(r.mtime).toISOString().slice(0, 16)}  ${r.path} — ${r.title}`)
          .join("\n")
      );
    }
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description: "List note paths, optionally under a folder.",
      inputSchema: {
        folder: z.string().optional().describe("Vault-relative folder to list (default: whole vault)"),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ folder, limit }) => {
      let paths = vault.listNoteFiles();
      if (folder) {
        const prefix = folder.replace(/\/+$/, "") + "/";
        paths = paths.filter((p) => p.startsWith(prefix));
      }
      paths = paths.slice(0, limit ?? 200);
      return text(paths.length ? paths.join("\n") : "No notes found.");
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[vortex-notes] MCP server on stdio | vault: ${vault.root}${opts.readOnly ? " | READ-ONLY" : ""}`
  );
}
