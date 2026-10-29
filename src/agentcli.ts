/**
 * Agent commands: the MCP tool set as plain shell commands, for agents and
 * scripts that run commands instead of speaking MCP (OpenClaw-style harnesses,
 * cron, git hooks, …). Same implementation as the MCP server (src/tools.ts).
 *
 *   vortex-notes search|read|write|edit|daily|remember|context|recent|list …
 *
 * Each call finds the vault (flag > env > cwd > the sole paired agent vault),
 * pulls before running and pushes after a write when the vault is linked, and
 * prints the tool's text — or its structured data with --json. Errors exit 1
 * (with {"error": …} on stdout under --json).
 */
import path from "node:path";
import { Vault } from "./vault.js";
import { Indexer } from "./indexer.js";
import { VaultTools, type ToolResult } from "./tools.js";

export interface AgentArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

export const AGENT_COMMANDS = ["search", "read", "write", "edit", "daily", "remember", "context", "recent", "list"] as const;
type AgentCommand = (typeof AGENT_COMMANDS)[number];
const WRITES = new Set<AgentCommand>(["write", "edit", "daily", "remember"]);
const NEEDS_INDEX = new Set<AgentCommand>(["search", "context", "recent"]);

export const AGENT_HELP = `Agent commands (same tools as the MCP server; for agents and scripts):
  vortex-notes search <query> [--limit 8] [--keyword]   Hybrid search
  vortex-notes read <path>                             Full note
  vortex-notes write <title> [<content>|-] [--folder f] [--tags a,b]
                                               Create a note (content arg, --content, or stdin)
  vortex-notes edit <path> --append <text> | --prepend <text> | --find <old> --replace <new>
  vortex-notes daily <text> [--date YYYY-MM-DD] Timestamped entry in today's daily note
  vortex-notes remember <fact> [--topic t] [--supersedes ^id|text]
                                               Durable fact in memory/*.md
  vortex-notes context <topic> [--max 4]       Top notes in full + linked notes
  vortex-notes recent [--days 7] [--limit 20]  Recently modified notes
  vortex-notes list [folder] [--limit 200]     Note paths
  Common: --json (structured output)  --offline (skip sync)  --read-only  --vault <dir>
  Text "-" (or piped stdin when omitted) reads from stdin.`;

export function isAgentCommand(cmd: string | undefined): cmd is AgentCommand {
  return !!cmd && (AGENT_COMMANDS as readonly string[]).includes(cmd);
}

/**
 * The vault an agent command (or mcp) acts on. --vault, VORTEX_NOTES_VAULT and a
 * vault in the cwd are honored as given; only the implicit default (~/VortexNotes)
 * yields to this machine's one paired vault — `pair` is the documented setup, and a
 * stale default must not shadow it.
 */
export async function resolveToolVault(vault: Vault, explicit: boolean): Promise<Vault> {
  if (explicit || process.env.VORTEX_NOTES_VAULT || vault.root === path.resolve(process.cwd())) return vault;
  const { findSoleAgentVault } = await import("./agents.js");
  const sole = findSoleAgentVault();
  if (!sole) return vault;
  process.env.VORTEX_NOTES_HOME = sole.home;
  return new Vault(sole.vault);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function runAgentCommand(cmd: AgentCommand, args: AgentArgs, baseVault: Vault): Promise<void> {
  const json = args.flags.has("json");
  const flag = (k: string) => (typeof args.flags.get(k) === "string" ? (args.flags.get(k) as string) : undefined);
  const num = (k: string, d: number) => {
    const v = flag(k);
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${k} must be a positive integer`);
    return n;
  };
  /** Text input: value, "-" = stdin, or piped stdin when nothing was given. */
  const text = async (value: string | undefined, what: string): Promise<string> => {
    if (value === "-" || (value === undefined && !process.stdin.isTTY)) value = (await readStdin()).replace(/\n$/, "");
    if (!value) throw new Error(`Missing ${what}. Pass it as an argument or pipe it on stdin.`);
    return value;
  };
  const warn = (msg: string) => console.error(`[vortex-notes] ${msg}`);

  let indexer: Indexer | null = null;
  try {
    const vault = await resolveToolVault(baseVault, args.flags.has("vault"));
    if (!vault.exists()) throw new Error(`No vault at ${vault.root}. Pair this machine (vortex-notes pair) or pass --vault <dir>.`);
    const { loadSyncState, syncVault } = await import("./sync.js");
    const linked = !args.flags.has("offline") && loadSyncState(vault) !== null;
    if (linked) await syncVault(vault).catch((e: Error) => warn(`pull failed, using local copy: ${e.message}`));

    indexer = new Indexer(vault);
    // Only semantic search needs embeddings; keyword search and recent skip the model.
    const semantic = (cmd === "search" && !args.flags.has("keyword")) || cmd === "context";
    if (NEEDS_INDEX.has(cmd)) await indexer.indexAll({ embed: semantic });
    const readOnly = args.flags.has("read-only") || process.env.VORTEX_NOTES_READONLY === "1";
    const tools = new VaultTools(vault, indexer, readOnly, false);
    const pos = args.positional;

    let result: ToolResult;
    switch (cmd) {
      case "search": {
        const query = pos.join(" ").trim();
        if (!query) throw new Error("Usage: vortex-notes search <query>");
        result = await tools.searchNotes(query, num("limit", 8), args.flags.has("keyword") ? "keyword" : "hybrid");
        break;
      }
      case "read":
        if (!pos[0]) throw new Error("Usage: vortex-notes read <path>");
        result = tools.readNote(pos[0]);
        break;
      case "write": {
        if (!pos[0]) throw new Error("Usage: vortex-notes write <title> [<content>|-]");
        const tags = (flag("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
        result = tools.writeNote(pos[0], await text(pos[1] ?? flag("content"), "note content"), flag("folder"), tags);
        break;
      }
      case "edit": {
        if (!pos[0]) throw new Error("Usage: vortex-notes edit <path> --append <text> | --prepend <text> | --find <old> --replace <new>");
        if (args.flags.has("append")) result = tools.editNote(pos[0], "append", await text(flag("append"), "--append text"));
        else if (args.flags.has("prepend")) result = tools.editNote(pos[0], "prepend", await text(flag("prepend"), "--prepend text"));
        else if (args.flags.has("find")) {
          const find = flag("find");
          if (!find) throw new Error("--find needs the exact text to replace");
          result = tools.editNote(pos[0], "find_replace", await text(flag("replace"), "--replace text"), find);
        } else throw new Error("edit needs --append, --prepend, or --find … --replace …");
        break;
      }
      case "daily":
        result = tools.appendDaily(await text(pos.join(" ") || undefined, "entry text"), flag("date"));
        break;
      case "remember":
        result = tools.remember(await text(pos.join(" ") || undefined, "fact"), flag("topic"), flag("supersedes"));
        break;
      case "context": {
        const topic = pos.join(" ").trim();
        if (!topic) throw new Error("Usage: vortex-notes context <topic>");
        result = await tools.buildContext(topic, num("max", 4));
        break;
      }
      case "recent":
        result = tools.recentActivity(num("days", 7), num("limit", 20));
        break;
      case "list":
        result = tools.listNotes(pos[0], num("limit", 200));
        break;
    }

    if (WRITES.has(cmd) && linked) {
      await syncVault(vault).catch((e: Error) => warn(`saved locally, but sync failed (retries on the next command): ${e.message}`));
    }
    console.log(json ? JSON.stringify(result.data, null, 2) : result.text);
  } catch (err) {
    const msg = (err as Error).message;
    if (json) console.log(JSON.stringify({ error: msg }));
    else console.error(msg);
    process.exitCode = 1;
  } finally {
    indexer?.close();
  }
}
