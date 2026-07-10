#!/usr/bin/env node
import { Vault } from "./vault.js";
import { Indexer } from "./indexer.js";
import { search } from "./search.js";
import { startMcpServer } from "./mcp.js";
import { startWebServer } from "./server.js";

const HELP = `vortex-notes — markdown vault with a first-party MCP server and local semantic search

Usage:
  vortex-notes init [--vault <dir>]           Create a vault (default: ~/VortexNotes)
  vortex-notes mcp [--vault <dir>] [--read-only] [--no-watch]
                                               Start the MCP server (stdio)
  vortex-notes serve [--vault <dir>] [--port <n>]
                                               Local web viewer (default http://127.0.0.1:7303)
  vortex-notes index [--vault <dir>]           (Re)build the search index
  vortex-notes search <query> [--vault <dir>] [--keyword]
                                               Search from the terminal

Vault resolution: --vault flag > VORTEX_NOTES_VAULT env > cwd if it has .vortex > ~/VortexNotes
Set VORTEX_NOTES_NO_SEMANTIC=1 to disable embeddings (keyword search only).`;

interface Args {
  command?: string;
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { positional: [], flags: new Map() };
  let i = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    args.command = argv[0];
    i = 1;
  }
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (key === "vault" || key === "port") args.flags.set(key, argv[++i]);
      else args.flags.set(key, true);
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const vault = Vault.resolve(args.flags.get("vault") as string | undefined);

  switch (args.command) {
    case "init": {
      vault.init();
      console.log(`Vault ready at ${vault.root}`);
      console.log(`\nAdd to your MCP client (e.g. Claude Code):`);
      console.log(`  claude mcp add vortex-notes -- vortex-notes mcp --vault "${vault.root}"`);
      break;
    }
    case "index": {
      requireVault(vault);
      const indexer = new Indexer(vault);
      const r = await indexer.indexAll();
      console.log(`Indexed ${r.indexed} changed notes (${r.total} total, ${r.removed} removed).`);
      indexer.close();
      break;
    }
    case "search": {
      requireVault(vault);
      const query = args.positional.join(" ").trim();
      if (!query) fail("Usage: vortex-notes search <query>");
      const indexer = new Indexer(vault);
      await indexer.indexAll();
      const results = await search(indexer, query, 8, args.flags.has("keyword") ? "keyword" : "hybrid");
      if (!results.length) console.log("No results.");
      for (const r of results) {
        console.log(`\n\x1b[1m${r.path}\x1b[0m${r.heading ? ` › ${r.heading}` : ""}  (${r.score})`);
        console.log(r.snippet.replace(/\n/g, " ").slice(0, 200));
      }
      indexer.close();
      break;
    }
    case "serve": {
      requireVault(vault);
      const port = Number(args.flags.get("port") ?? 7303);
      const { port: actual } = await startWebServer(vault, { port });
      console.log(`Vortex Notes → http://127.0.0.1:${actual}  (vault: ${vault.root})`);
      break;
    }
    case "mcp": {
      await startMcpServer(vault, {
        readOnly: args.flags.has("read-only") || process.env.VORTEX_NOTES_READONLY === "1",
        watch: !args.flags.has("no-watch"),
      });
      // Keep process alive; transport closes on stdin end.
      break;
    }
    case undefined:
    case "help": {
      console.log(HELP);
      break;
    }
    default:
      fail(`Unknown command: ${args.command}\n\n${HELP}`);
  }
}

function requireVault(vault: Vault): void {
  if (!vault.exists()) {
    fail(`No vault at ${vault.root}. Run: vortex-notes init --vault "${vault.root}"`);
  }
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch((err) => fail(`Error: ${(err as Error).message}`));
