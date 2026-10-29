import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { z } from "zod";
import { Vault } from "./vault.js";
import { Indexer, startVaultWatcher } from "./indexer.js";
import { VaultTools } from "./tools.js";

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
  const { startAutoSync } = await import("./autosync.js");
  const autoSync = startAutoSync(vault); // no-op unless linked to a relay

  const { version } = createRequire(import.meta.url)(
    import.meta.url.includes("/dist-test/") ? "../../package.json" : "../package.json"
  ) as { version: string };
  const server = new McpServer({ name: "vortex-notes", version });
  // Writes push within a second, not at the next 30s tick: short sessions
  // (claude -p, a quick chat) often end before that tick would come.
  const tools = new VaultTools(vault, indexer, opts.readOnly, true, () => autoSync.nudge());
  const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

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
    async ({ query, limit, mode }) => text((await tools.searchNotes(query, limit ?? 8, mode ?? "hybrid")).text)
  );

  server.registerTool(
    "read_note",
    {
      title: "Read note",
      description: "Read a note's full markdown content by vault-relative path.",
      inputSchema: { path: z.string().describe("Vault-relative path, e.g. 'projects/idea.md'") },
      annotations: { readOnlyHint: true },
    },
    async ({ path: rel }) => text(tools.readNote(rel).text)
  );

  server.registerTool(
    "write_note",
    {
      title: "Create note",
      annotations: { readOnlyHint: false, destructiveHint: false },
      description:
        "Create a new markdown note. Fails if the path already exists — use edit_note to modify existing notes.",
      inputSchema: {
        title: z.string().describe("Note title"),
        content: z.string().describe("Markdown body"),
        folder: z.string().optional().describe("Optional vault-relative folder, e.g. 'projects'"),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ title, content, folder, tags }) => text(tools.writeNote(title, content, folder, tags ?? []).text)
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
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ path: rel, operation, content, find }) => text(tools.editNote(rel, operation, content, find).text)
  );

  server.registerTool(
    "append_daily",
    {
      title: "Append to daily note",
      annotations: { readOnlyHint: false, destructiveHint: false },
      description:
        "Append a timestamped entry to today's daily note (or a given date). The right place for observations, decisions, and things to remember.",
      inputSchema: {
        content: z.string().describe("Markdown for the entry (one bullet)"),
        date: z.string().optional().describe("YYYY-MM-DD (default: today)"),
      },
    },
    async ({ content, date }) => text(tools.appendDaily(content, date).text)
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
    async ({ topic, max_notes }) => text((await tools.buildContext(topic, max_notes ?? 4)).text)
  );

  server.registerTool(
    "remember",
    {
      title: "Remember a fact",
      annotations: { readOnlyHint: false, destructiveHint: false },
      description:
        "Record a durable fact in the shared memory (memory/*.md) as a dated bullet with a stable ^id. If it replaces an earlier fact, pass supersedes (the old fact's ^id, or a distinctive substring of it) — the old fact stays visible with strikethrough and a pointer to the new one. Use search_notes to find existing facts first.",
      inputSchema: {
        fact: z.string().describe("The fact, stated so it makes sense without conversation context"),
        topic: z.string().optional().describe("Optional topic — facts go to memory/<topic>.md instead of memory/facts.md"),
        supersedes: z.string().optional().describe("^id or distinctive substring of the fact this replaces"),
      },
    },
    async ({ fact, topic, supersedes }) => text(tools.remember(fact, topic, supersedes).text)
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
    async ({ days, limit }) => text(tools.recentActivity(days ?? 7, limit ?? 20).text)
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
    async ({ folder, limit }) => text(tools.listNotes(folder, limit ?? 200).text)
  );

  // When the client ends the session, finish pending pushes before exiting.
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const cap = setTimeout(() => process.exit(0), 8000);
    void autoSync.flush().finally(() => {
      clearTimeout(cap);
      process.exit(0);
    });
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[vortex-notes] MCP server on stdio | vault: ${vault.root}${opts.readOnly ? " | READ-ONLY" : ""}`
  );
}
