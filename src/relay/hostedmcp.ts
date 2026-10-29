/**
 * Hosted MCP for chat apps that can only reach a public URL (claude.ai,
 * ChatGPT, …). A "cloud agent" is an ordinary agent principal whose private
 * keys the owner chose to hand to the relay; with them the relay opens that
 * agent's sealed space key and serves the notes over Streamable HTTP MCP
 * (stateless JSON-RPC, JSON responses). This is the one place the relay sees
 * plaintext — opt-in, scoped to the agent's spaces, revoked with the agent.
 *
 * Same tool names and note format as the local stdio server (src/mcp.ts);
 * search is keyword-only here (no local embedding model on the relay).
 */
import { decryptPayload, encryptPayload, utf8 } from "../crypto.js";
import { NoteOps, parseNote } from "../notes.js";
import { isLockedContent } from "../notelock.js";
import { slugify } from "../textutil.js";

export interface HostedSession {
  spaceId: string;
  spaceKey: Uint8Array;
  readOnly: boolean;
}

export interface HostedDeps {
  /** Encrypted updates of a space after `since`, ascending seq. */
  pull(spaceId: string, since: number): { seq: number; doc: string; blob: Uint8Array }[];
  /** Store an encrypted update authored by the cloud agent; returns its seq. */
  push(spaceId: string, doc: string, blob: Uint8Array): number;
}

interface Doc {
  content: string;
  mtimeMs: number;
}

const PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const INSTRUCTIONS =
  "The user's Vortex Notes vault (markdown). Search before answering from memory; use remember() for durable facts " +
  "(pass supersedes when a fact changes) and append_daily() for observations. Prefer edit_note over rewriting notes.";

type Json = Record<string, unknown>;
const str = (description: string) => ({ type: "string", description });
const int = (description: string, minimum: number, maximum: number) => ({ type: "integer", description, minimum, maximum });
const RO = { readOnlyHint: true };

const TOOLS: { name: string; title: string; description: string; inputSchema: Json; annotations?: Json; write?: boolean }[] = [
  {
    name: "search_notes",
    title: "Search notes",
    description: "Keyword search over the vault. Returns note paths, titles, and snippets. Use read_note for full content.",
    inputSchema: { type: "object", properties: { query: str("Keywords to look for"), limit: int("Max results (default 8)", 1, 25) }, required: ["query"] },
    annotations: RO,
  },
  {
    name: "read_note",
    title: "Read note",
    description: "Read a note's full markdown content by vault-relative path.",
    inputSchema: { type: "object", properties: { path: str("Vault-relative path, e.g. 'projects/idea.md'") }, required: ["path"] },
    annotations: RO,
  },
  {
    name: "list_notes",
    title: "List notes",
    description: "List note paths, optionally under a folder.",
    inputSchema: { type: "object", properties: { folder: str("Vault-relative folder (default: whole vault)"), limit: int("Max paths (default 200)", 1, 500) } },
    annotations: RO,
  },
  {
    name: "recent_activity",
    title: "Recent activity",
    description: "List notes modified in the last N days, newest first.",
    inputSchema: { type: "object", properties: { days: int("Lookback window (default 7)", 1, 365), limit: int("Max notes (default 20)", 1, 50) } },
    annotations: RO,
  },
  {
    name: "build_context",
    title: "Build context",
    description:
      "Load working context for a topic in one call: full content of the top-matching notes plus one hop of [[wikilinked]] notes as pointers.",
    inputSchema: { type: "object", properties: { topic: str("Topic, question, or entity"), max_notes: int("Primary notes in full (default 4)", 1, 10) }, required: ["topic"] },
    annotations: RO,
  },
  {
    name: "write_note",
    title: "Create note",
    description: "Create a new markdown note. Fails if the path already exists — use edit_note to modify existing notes.",
    inputSchema: {
      type: "object",
      properties: { title: str("Note title"), content: str("Markdown body"), folder: str("Optional vault-relative folder"), tags: { type: "array", items: { type: "string" } } },
      required: ["title", "content"],
    },
    write: true,
  },
  {
    name: "edit_note",
    title: "Edit note",
    description: "Edit an existing note surgically: append, prepend, or find_replace (exact string). Prefer this over rewriting whole notes.",
    inputSchema: {
      type: "object",
      properties: {
        path: str("Vault-relative path"),
        operation: { type: "string", enum: ["append", "prepend", "find_replace"] },
        content: str("Text to append/prepend, or replacement text for find_replace"),
        find: str("Exact string to find (find_replace only)"),
      },
      required: ["path", "operation", "content"],
    },
    annotations: { destructiveHint: true },
    write: true,
  },
  {
    name: "append_daily",
    title: "Append to daily note",
    description: "Append a timestamped entry to today's daily note (or a given date). The right place for observations and decisions.",
    inputSchema: { type: "object", properties: { content: str("Markdown for the entry (one bullet)"), date: str("YYYY-MM-DD (default: today)") }, required: ["content"] },
    write: true,
  },
  {
    name: "remember",
    title: "Remember a fact",
    description:
      "Record a durable fact in memory/*.md as a dated bullet with a stable ^id. If it replaces an earlier fact, pass supersedes (the old ^id or a distinctive substring) — the old fact stays visible, struck through.",
    inputSchema: {
      type: "object",
      properties: {
        fact: str("The fact, stated so it makes sense without conversation context"),
        topic: str("Optional topic — facts go to memory/<topic>.md instead of memory/facts.md"),
        supersedes: str("^id or distinctive substring of the fact this replaces"),
      },
      required: ["fact"],
    },
    write: true,
  },
];

export function createHostedMcp(deps: HostedDeps) {
  // Decrypted view per space, advanced incrementally by seq. Lives as long as
  // the relay process / Durable Object instance; rebuilt from ciphertext after.
  const cache = new Map<string, { seq: number; docs: Map<string, Doc> }>();

  function docsOf(sess: HostedSession): Map<string, Doc> {
    let c = cache.get(sess.spaceId);
    if (!c) cache.set(sess.spaceId, (c = { seq: 0, docs: new Map() }));
    for (const u of deps.pull(sess.spaceId, c.seq)) {
      c.seq = Math.max(c.seq, u.seq);
      try {
        const p = JSON.parse(new TextDecoder().decode(decryptPayload(sess.spaceKey, u.blob, `vortex-doc-v1:${u.doc}`))) as {
          path: string;
          content: string;
          mtimeMs: number;
          deleted?: boolean;
        };
        if (p.deleted) c.docs.delete(p.path);
        else c.docs.set(p.path, { content: p.content, mtimeMs: p.mtimeMs });
      } catch { /* not decryptable with this key (e.g. other space) */ }
    }
    return c.docs;
  }

  function opsFor(sess: HostedSession, docs: Map<string, Doc>): NoteOps {
    return new NoteOps({
      read: (rel) => docs.get(rel)?.content ?? null,
      write: (rel, raw) => {
        const mtimeMs = Date.now();
        const blob = encryptPayload(sess.spaceKey, utf8(JSON.stringify({ v: 1, path: rel, content: raw, mtimeMs })), `vortex-doc-v1:${rel}`);
        deps.push(sess.spaceId, rel, blob);
        docs.set(rel, { content: raw, mtimeMs });
      },
    });
  }

  function search(docs: Map<string, Doc>, query: string, limit: number) {
    const terms = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2))];
    if (!terms.length) return [];
    const hits: { path: string; title: string; score: number; snippet: string }[] = [];
    for (const [p, d] of docs) {
      const note = parseNote(p, d.content);
      const locked = isLockedContent(note.body);
      const body = locked ? "" : note.body.toLowerCase();
      const title = note.title.toLowerCase();
      let score = 0;
      let first = -1;
      for (const t of terms) {
        if (title.includes(t)) score += 5;
        if (p.toLowerCase().includes(t)) score += 2;
        let i = body.indexOf(t);
        if (i >= 0 && (first < 0 || i < first)) first = i;
        for (let n = 0; i >= 0 && n < 20; n++, i = body.indexOf(t, i + t.length)) score += 1;
      }
      if (!score) continue;
      const start = Math.max(0, first - 80);
      const snippet = locked
        ? "[password-protected]"
        : (start ? "…" : "") + note.body.slice(start, start + 220).replace(/\s+/g, " ").trim();
      hits.push({ path: p, title: note.title, score, snippet });
    }
    return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
  }

  const notePath = (rel: string): string => {
    const clean = rel.replace(/^\/+/, "");
    if (!clean.endsWith(".md") || clean.split("/").some((seg) => !seg || seg === ".." || seg.startsWith("."))) {
      throw new Error(`Not a note path: ${rel}`);
    }
    return clean;
  };

  function callTool(sess: HostedSession, name: string, a: Json): string {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    if (tool.write && sess.readOnly) throw new Error("This connector is read-only.");
    const docs = docsOf(sess);
    const ops = opsFor(sess, docs);
    const s = (k: string) => (a[k] === undefined || a[k] === null ? undefined : String(a[k]));
    const n = (k: string, d: number) => (typeof a[k] === "number" ? (a[k] as number) : d);

    switch (name) {
      case "search_notes": {
        const r = search(docs, s("query") ?? "", n("limit", 8));
        return r.length ? r.map((h, i) => `${i + 1}. ${h.path} — ${h.title}\n${h.snippet}`).join("\n\n") : "No results.";
      }
      case "read_note": {
        const note = ops.readNote(notePath(s("path") ?? ""));
        const tags = note.tags.length ? ` | tags: ${note.tags.join(", ")}` : "";
        if (isLockedContent(note.body)) {
          return `# ${note.title}\npath: ${note.path}${tags}\n\n[This note is password-protected. Its contents are encrypted and cannot be read here.]`;
        }
        return `# ${note.title}\npath: ${note.path}${tags}\n\n${note.body}`;
      }
      case "list_notes": {
        const folder = s("folder")?.replace(/\/+$/, "");
        const paths = [...docs.keys()].filter((p) => !folder || p.startsWith(folder + "/")).sort().slice(0, n("limit", 200));
        return paths.length ? paths.join("\n") : "No notes found.";
      }
      case "recent_activity": {
        const cutoff = Date.now() - n("days", 7) * 86400_000;
        const rows = [...docs].filter(([, d]) => d.mtimeMs > cutoff).sort((x, y) => y[1].mtimeMs - x[1].mtimeMs).slice(0, n("limit", 20));
        if (!rows.length) return "No notes modified in that window.";
        return rows.map(([p, d]) => `${new Date(d.mtimeMs).toISOString().slice(0, 16)}  ${p} — ${parseNote(p, d.content).title}`).join("\n");
      }
      case "build_context": {
        const topic = s("topic") ?? "";
        const primaries = search(docs, topic, n("max_notes", 4)).map((h) => h.path);
        if (!primaries.length) return `No notes found for "${topic}".`;
        const byKey = new Map<string, string>();
        for (const p of docs.keys()) {
          byKey.set(parseNote(p, docs.get(p)!.content).title.toLowerCase(), p);
          byKey.set((p.split("/").pop() ?? "").replace(/\.md$/, "").toLowerCase(), p);
        }
        const links = (body: string) => [...body.matchAll(/\[\[([^\]|#]+)/g)].map((m) => byKey.get(m[1].trim().toLowerCase())).filter(Boolean) as string[];
        const prim = new Set(primaries);
        const related = new Set<string>();
        for (const [p, d] of docs) {
          const out = links(d.content);
          if (prim.has(p)) out.filter((t) => !prim.has(t)).forEach((t) => related.add(t)); // outgoing
          else if (out.some((t) => prim.has(t))) related.add(p); // backlink
        }
        const parts = [`Context for: ${topic}`];
        for (const p of primaries) {
          const note = ops.readNote(p);
          const body = isLockedContent(note.body)
            ? "[password-protected]"
            : note.body.length > 2500 ? note.body.slice(0, 2500) + "\n…(truncated — use read_note for the rest)" : note.body;
          parts.push(`\n===== ${p} — ${note.title} =====\n${body.trim()}`);
        }
        if (related.size) {
          parts.push(`\n===== Linked notes (one hop; use read_note for full content) =====`);
          for (const p of [...related].slice(0, 6)) parts.push(`- ${p} — ${parseNote(p, docs.get(p)!.content).title}`);
        }
        return parts.join("\n");
      }
      case "write_note": {
        const title = s("title") ?? "";
        const folder = (s("folder") ?? "").replace(/^\/+|\/+$/g, "");
        const rel = notePath((folder ? folder + "/" : "") + slugify(title) + ".md");
        if (ops.exists(rel)) throw new Error(`Note already exists: ${rel}. Use edit_note to modify it.`);
        const tags = Array.isArray(a.tags) ? a.tags.map(String) : [];
        ops.writeNote(rel, title, s("content") ?? "", tags);
        return `Created ${rel}`;
      }
      case "edit_note": {
        const rel = notePath(s("path") ?? "");
        const note = ops.readNote(rel);
        if (isLockedContent(note.body)) throw new Error("This note is password-protected and can't be edited here.");
        const op = s("operation");
        const content = s("content") ?? "";
        let body: string;
        if (op === "append") body = note.body.trimEnd() + "\n\n" + content.trim();
        else if (op === "prepend") body = content.trim() + "\n\n" + note.body.trimStart();
        else if (op === "find_replace") {
          const find = s("find");
          if (!find) throw new Error("find_replace requires 'find'");
          if (!note.body.includes(find)) throw new Error(`String not found in ${rel}: ${JSON.stringify(find.slice(0, 80))}`);
          body = note.body.replace(find, content);
        } else throw new Error(`Unknown operation: ${op}`);
        ops.updateNote(rel, body);
        return `Updated ${rel} (${op})`;
      }
      case "append_daily":
        return `Appended to ${ops.appendDaily(s("content") ?? "", s("date"))}`;
      case "remember": {
        const r = ops.rememberFact(s("fact") ?? "", s("topic"), s("supersedes"));
        return `Recorded ^${r.id} in ${r.rel}${r.superseded ? ` (supersedes ^${r.superseded})` : ""}`;
      }
    }
    throw new Error(`Unknown tool: ${name}`);
  }

  /** One JSON-RPC message → response object, or null for notifications. */
  function rpc(sess: HostedSession, msg: Json): Json | null {
    const id = msg.id ?? null;
    const method = String(msg.method ?? "");
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
    if (msg.id === undefined) return null; // notification (initialized, cancelled, …)
    const params = (msg.params ?? {}) as Json;
    switch (method) {
      case "initialize": {
        const asked = String(params.protocolVersion ?? "");
        return ok({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[PROTOCOLS.length - 1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "vortex-notes", title: "Vortex Notes", version: "0.1.8" },
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({
          tools: TOOLS.filter((t) => !(t.write && sess.readOnly)).map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            ...(annotations ? { annotations } : {}),
          })),
        });
      case "tools/call": {
        try {
          const text = callTool(sess, String(params.name ?? ""), (params.arguments ?? {}) as Json);
          return ok({ content: [{ type: "text", text }] });
        } catch (err) {
          return ok({ content: [{ type: "text", text: (err as Error).message }], isError: true });
        }
      }
      case "resources/list":
        return ok({ resources: [] });
      case "prompts/list":
        return ok({ prompts: [] });
      default:
        return fail(-32601, `Method not found: ${method}`);
    }
  }

  return { rpc };
}
