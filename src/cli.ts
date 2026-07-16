#!/usr/bin/env node
import fs from "node:fs";
import { Vault } from "./vault.js";
import { Indexer } from "./indexer.js";
import { search } from "./search.js";
import { isLockedContent, lockContent, unlockContent } from "./notelock.js";
import { startMcpServer } from "./mcp.js";
import { startWebServer } from "./server.js";
import { initIdentity, loginIdentity, loadIdentity, hasIdentity, vortexHome } from "./identity.js";
import { createSpace, listSpaces, getSpace, openSpaceKey, encryptDoc, decryptDoc } from "./spaces.js";

const DEFAULT_RELAY = "https://vortex-relay.fly.dev";

const HELP = `vortex-notes — markdown vault with a first-party MCP server and local semantic search

Usage:
  vortex-notes pair [--name <agent>] [--relay <url>]
                                               Connect this machine as an agent: shows a code,
                                               you approve it in the web app, done
  vortex-notes setup [--vault <dir>] [--relay <url>]
                                               Everything in one go: asks your 12 words, joins
                                               your notes, first sync. New machine → done.
  vortex-notes init [--vault <dir>]           Create a vault (default: ~/VortexNotes)
  vortex-notes mcp [--vault <dir>] [--read-only] [--no-watch]
                                               Start the MCP server (stdio)
  vortex-notes serve [--vault <dir>] [--port <n>]
                                               Local web viewer (default http://127.0.0.1:7303)
  vortex-notes index [--vault <dir>]           (Re)build the search index
  vortex-notes search <query> [--vault <dir>] [--keyword]
                                               Search from the terminal
  vortex-notes unlock <note.md> [--vault <dir>]
                                               Read a password-protected note (prompts for password)
  vortex-notes lock <note.md> [--vault <dir>]  Password-protect a note in place

  vortex-notes identity init [--name <device>]  Create your identity (shows recovery phrase ONCE)
  vortex-notes identity login [--name <device>] Sign in on this machine with your phrase
  vortex-notes identity show                    Fingerprint + device info
  vortex-notes space create <name>              Create an encrypted space
  vortex-notes space list                       List spaces on this machine
  vortex-notes relay [--port <n>] [--db <file>] Run a sync relay (self-host; stores ciphertext only)

  vortex-notes agent create <name> --space <name|id>[,<more>] --relay <url> [--read-only]
                                                Grant an agent scoped access; prints its token ONCE
  vortex-notes agent request --relay <url> [--name <agent>]
                                                No-token pairing: prints a short code, waits
                                                for your approval, sets everything up
  vortex-notes agent approve <code> --space <name|id>[,..] --relay <url> [--read-only]
                                                (on YOUR machine) approve a pairing code
  vortex-notes agent mcp <token>                ONE command on the agent's machine: bootstrap
                                                on first run, then serve MCP (stdio), auto-sync
  vortex-notes agent connect <token> [--vault <dir>]
                                                Bootstrap only (prints paths + MCP wiring)
  vortex-notes agent list                       Agents you've created here
  vortex-notes agent revoke <name> --relay <url>
                                                Cut an agent off (relay ban + grant removal)
  vortex-notes sync link --relay <url> --space <name> [--vault <dir>]
                                                Link this vault to a space (first machine)
  vortex-notes sync join --relay <url> [--space <id>] [--vault <dir>]
                                                Join your space here (asks for recovery phrase once)
  vortex-notes sync [--vault <dir>]             Pull + push encrypted changes
  vortex-notes sync status [--vault <dir>]      Show link + cursor

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
      if (["vault", "port", "name", "db", "relay", "space"].includes(key)) args.flags.set(key, argv[++i]);
      else args.flags.set(key, true);
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has("help") || args.flags.has("h")) {
    console.log(HELP);
    return;
  }
  const vault = Vault.resolve(args.flags.get("vault") as string | undefined);

  switch (args.command) {
    case "setup": {
      const relay = (args.flags.get("relay") as string) ?? DEFAULT_RELAY;
      const { joinVault, syncVault, loadSyncState } = await import("./sync.js");
      if (!hasIdentity()) {
        const phrase = await promptHidden("Your 12-word recovery phrase (from the app or 'identity init'): ");
        const deviceName = `${process.env.USER ?? "device"}@${(await import("node:os")).default.hostname()}`;
        loginIdentity(phrase, deviceName);
        vault.init();
        if (!loadSyncState(vault)) await joinVault(vault, relay, phrase);
      } else {
        console.log("Identity already on this machine — checking the vault…");
        vault.init();
        if (!loadSyncState(vault)) {
          const phrase = await promptHidden("Your 12-word recovery phrase (needed once to join the space): ");
          await joinVault(vault, relay, phrase);
        }
      }
      const r = await syncVault(vault);
      console.log(`\nDone. Your notes live at ${vault.root} (${r.pulled} pulled).`);
      console.log(`\nUseful next steps:`);
      console.log(`  vortex-notes search "anything"                      # local semantic search`);
      console.log(`  vortex-notes serve                                  # local web app`);
      console.log(`  claude mcp add vortex-notes -- vortex-notes mcp --vault ${vault.root}`);
      break;
    }
    case "pair": {
      const { requestPairing } = await import("./agents.js");
      const relay = (args.flags.get("relay") as string) ?? DEFAULT_RELAY;
      const name = (args.flags.get("name") as string) ?? `agent@${(await import("node:os")).default.hostname()}`;
      const { code, complete } = await requestPairing(relay, name);
      console.log(`\n  Pairing code:  ${code.split("").join(" ")}\n`);
      console.log(`Approve it from your notes app (${relay}/app):`);
      console.log(`  ⋯ menu → Pair an agent → type the code\n`);
      console.log(`Waiting for approval…`);
      const r = await complete();
      console.log(`\nPaired as "${r.name}". Notes are syncing to ${r.vault}`);

      // Wire known harnesses automatically. We pass the EXACT vault via env
      // (VORTEX_NOTES_VAULT) so the server is pinned to this paired vault —
      // never guessing, never falling back to some other vault on the machine.
      // Absolute node + script paths sidestep PATH problems.
      const { spawnSync } = await import("node:child_process");
      const fsm = await import("node:fs");
      const cliPath = fsm.default.realpathSync(process.argv[1]);
      const vaultEnv = `VORTEX_NOTES_VAULT=${r.vault}`;
      let wired = false;
      // Replace any stale entry first so re-pairs never leave a wrong one behind.
      spawnSync("hermes", ["mcp", "remove", "vortex-notes"], { encoding: "utf8", timeout: 15000 });
      const hermes = spawnSync(
        "hermes",
        ["mcp", "add", "vortex-notes", "--command", process.execPath, "--env", vaultEnv, "--args", cliPath, "mcp"],
        { input: "Y\n", encoding: "utf8", timeout: 30000 }
      );
      if (hermes.status === 0) {
        console.log(`\n✓ Wired into Hermes, pinned to this vault — type /reload-mcp in your Hermes chat and you're done.`);
        wired = true;
      }
      if (!wired) {
        spawnSync("claude", ["mcp", "remove", "vortex-notes"], { encoding: "utf8", timeout: 15000 });
        const claude = spawnSync(
          "claude",
          ["mcp", "add", "vortex-notes", "--env", vaultEnv, "--", process.execPath, cliPath, "mcp"],
          { encoding: "utf8", timeout: 30000 }
        );
        if (claude.status === 0) {
          console.log(`\n✓ Wired into Claude Code, pinned to this vault.`);
          wired = true;
        }
      }
      if (!wired) {
        console.log(`\nWire it into your agent — the vault is pinned via VORTEX_NOTES_VAULT so it can't drift:`);
        console.log(`  Hermes:      hermes mcp add vortex-notes --command ${process.execPath} --env ${vaultEnv} --args ${cliPath} mcp`);
        console.log(`  Claude Code: claude mcp add vortex-notes --env ${vaultEnv} -- vortex-notes mcp`);
        console.log(`  Any MCP:     { "command": "vortex-notes", "args": ["mcp"], "env": { "VORTEX_NOTES_VAULT": "${r.vault}" } }`);
      }
      break;
    }
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
    case "unlock": {
      requireVault(vault);
      const rel = args.positional[0];
      if (!rel) fail("Usage: vortex-notes unlock <note.md>");
      const abs = vault.abs(rel);
      if (!fs.existsSync(abs)) fail(`No such note: ${rel}`);
      const content = fs.readFileSync(abs, "utf8");
      if (!isLockedContent(content)) {
        console.log(content); // not locked — just print it
        break;
      }
      const pw = await promptHidden("Password: ");
      const r = unlockContent(content, pw);
      if (!r) fail("Wrong password.");
      const title = vault.readNote(rel).title;
      console.log(`\n# ${title}\n`);
      console.log(r.body);
      break;
    }
    case "lock": {
      requireVault(vault);
      const rel = args.positional[0];
      if (!rel) fail("Usage: vortex-notes lock <note.md>");
      const abs = vault.abs(rel);
      if (!fs.existsSync(abs)) fail(`No such note: ${rel}`);
      const content = fs.readFileSync(abs, "utf8");
      if (isLockedContent(content)) fail("That note is already password-protected.");
      const pw = await promptHidden("Set a password (lost = unrecoverable): ");
      if (!pw) fail("No password entered.");
      if ((await promptHidden("Confirm password: ")) !== pw) fail("Passwords didn't match.");
      fs.writeFileSync(abs, lockContent(content, pw));
      console.log(`Locked ${rel}. Its body is now encrypted; unlock with 'vortex-notes unlock ${rel}'.`);
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
      let target = vault;
      if (!args.flags.get("vault") && !process.env.VORTEX_NOTES_VAULT && !vault.exists()) {
        const { findSoleAgentVault } = await import("./agents.js");
        const sole = findSoleAgentVault();
        if (sole) {
          process.env.VORTEX_NOTES_HOME = sole.home;
          target = new Vault(sole.vault);
          console.error(`[vortex-notes] serving paired agent vault: ${sole.vault}`);
        }
      }
      await startMcpServer(target, {
        readOnly: args.flags.has("read-only") || process.env.VORTEX_NOTES_READONLY === "1",
        watch: !args.flags.has("no-watch"),
      });
      // Keep process alive; transport closes on stdin end.
      break;
    }
    case "identity": {
      const sub = args.positional[0];
      const deviceName = (args.flags.get("name") as string) ?? `${process.env.USER ?? "device"}@${(await import("node:os")).default.hostname()}`;
      if (sub === "init") {
        const { phrase, identity } = initIdentity(deviceName);
        console.log("Your recovery phrase — write it down now, it is shown ONCE and never stored:\n");
        console.log(`  ${phrase}\n`);
        console.log("Anyone with these 12 words can read your notes. There is no reset:");
        console.log("lose the phrase and your devices, and the data is unrecoverable by design.\n");
        console.log(`Account fingerprint: ${identity.file.fingerprint}`);
        console.log(`Device enrolled:     ${identity.file.device.name}`);
        console.log(`Stored at:           ${vortexHome()}`);
      } else if (sub === "login") {
        const phrase = await promptHidden("Enter your 12-word recovery phrase: ");
        const identity = loginIdentity(phrase, deviceName);
        console.log(`\nSigned in. Account fingerprint: ${identity.file.fingerprint}`);
        console.log(`Device enrolled: ${identity.file.device.name}`);
      } else if (sub === "show") {
        const id = loadIdentity();
        console.log(`Account fingerprint: ${id.file.fingerprint}`);
        console.log(`Device:              ${id.file.device.name} (enrolled ${id.file.device.createdAt.slice(0, 10)})`);
        console.log(`Device cert:         valid`);
        console.log(`Home:                ${vortexHome()}`);
      } else {
        fail("Usage: vortex-notes identity <init|login|show>");
      }
      break;
    }
    case "space": {
      const sub = args.positional[0];
      if (sub === "create") {
        const name = args.positional.slice(1).join(" ").trim();
        if (!name) fail("Usage: vortex-notes space create <name>");
        const identity = loadIdentity();
        const space = createSpace(identity, name);
        // Sanity roundtrip so a broken keychain fails loudly at create time.
        const key = openSpaceKey(identity, space);
        decryptDoc(key, "probe", encryptDoc(key, "probe", "ok"));
        console.log(`Created encrypted space "${name}" (${space.id}).`);
      } else if (sub === "list") {
        const spaces = listSpaces();
        if (!spaces.length) {
          console.log("No spaces yet. Create one: vortex-notes space create <name>");
          break;
        }
        const canOpen = hasIdentity() ? loadIdentity() : null;
        for (const s of spaces) {
          let status = "no key on this device";
          if (canOpen) {
            try {
              openSpaceKey(canOpen, s);
              status = "unlockable here";
            } catch { /* keep default */ }
          }
          console.log(`${s.id}  ${s.name}  (${Object.keys(s.sealedKeys).length} member keys, ${status})`);
        }
      } else {
        fail("Usage: vortex-notes space <create|list>");
      }
      break;
    }
    case "sync": {
      requireVault(vault);
      const { linkVault, joinVault, syncVault, loadSyncState, relinkVault } = await import("./sync.js");
      const sub = args.positional[0];
      if (sub === "link") {
        const relay = (args.flags.get("relay") as string) ?? DEFAULT_RELAY;
        const spaceName = args.flags.get("space") as string;
        if (!spaceName) fail("Usage: vortex-notes sync link --space <name> [--relay <url>]");
        const state = await linkVault(vault, relay, spaceName);
        console.log(`Linked vault to space ${state.spaceId} on ${relay}. Run 'vortex-notes sync' to push.`);
      } else if (sub === "join") {
        const relay = (args.flags.get("relay") as string) ?? DEFAULT_RELAY;
        const phrase = await promptHidden("Enter your 12-word recovery phrase (needed once to unseal the space key): ");
        const state = await joinVault(vault, relay, phrase, args.flags.get("space") as string | undefined);
        console.log(`Joined space ${state.spaceId}. Run 'vortex-notes sync' to pull your notes.`);
      } else if (sub === "relink") {
        const relay = args.flags.get("relay") as string;
        if (!relay) fail("Usage: vortex-notes sync relink --relay <url>");
        const state = await relinkVault(vault, relay);
        console.log(`Relinked to ${relay} (space ${state.spaceId}). Run 'vortex-notes sync' to push everything.`);
      } else if (sub === "status") {
        const state = loadSyncState(vault);
        if (!state) console.log("Not linked. Use 'sync link' or 'sync join'.");
        else {
          console.log(`Linked to ${state.spaceId} via ${state.relay} — cursor ${state.cursor}, ${Object.keys(state.files).length} files tracked.`);
          try {
            if (state.home) process.env.VORTEX_NOTES_HOME = state.home;
            const { RelayClient } = await import("./relay/client.js");
            const usage = await new RelayClient(state.relay, loadIdentity()).getUsage();
            const used = (usage.bytesUsed / 1e6).toFixed(1);
            console.log(usage.quotaBytes ? `Storage: ${used}MB of ${Math.round(usage.quotaBytes / 1e6)}MB` : `Storage: ${used}MB (no quota)`);
          } catch { /* offline is fine */ }
        }
      } else if (sub === undefined || sub === "now") {
        const r = await syncVault(vault);
        console.log(`Synced: pulled ${r.pulled}, pushed ${r.pushed}${r.conflicts.length ? `, conflicts: ${r.conflicts.join(", ")}` : ""}.`);
      } else {
        fail("Usage: vortex-notes sync [link|join|status]");
      }
      break;
    }
    case "agent": {
      const { createAgent, ensureAgentConnected, listAgents, revokeAgent, requestPairing, approvePairing } = await import("./agents.js");
      const sub = args.positional[0];
      if (sub === "create") {
        const name = args.positional[1];
        const relay = args.flags.get("relay") as string;
        const spacesArg = args.flags.get("space") as string;
        if (!name || !relay || !spacesArg) fail("Usage: vortex-notes agent create <name> --space <name|id>[,<more>] --relay <url> [--read-only]");
        const mode = args.flags.has("read-only") ? ("ro" as const) : ("rw" as const);
        const { token, record } = await createAgent(name, spacesArg.split(","), mode, relay);
        console.log(`Agent "${name}" created (${mode === "ro" ? "read-only" : "read+write"}, spaces: ${record.spaces.join(", ")}).`);
        console.log(`
Agent token — paste it on the agent's machine. Shown once; treat it like a password:
`);
        console.log(token);
        console.log(`
On the agent's machine:
  VORTEX_NOTES_HOME=~/.vortex-agent vortex-notes agent connect '<token>' --vault ~/agent-vault
  VORTEX_NOTES_HOME=~/.vortex-agent vortex-notes mcp --vault ~/agent-vault`);
      } else if (sub === "connect") {
        const token = args.positional[1];
        if (!token) fail("Usage: vortex-notes agent connect <token> [--vault <dir>]");
        const r = await ensureAgentConnected(token, args.flags.get("vault") as string | undefined);
        const { syncVault } = await import("./sync.js");
        const { Vault: V } = await import("./vault.js");
        const pull = await syncVault(new V(r.vault));
        console.log(`${r.firstRun ? "Connected" : "Already connected"} as agent "${r.name}" (${r.mode === "ro" ? "read-only" : "read+write"}).`);
        console.log(`Vault: ${r.vault} (pulled ${pull.pulled} notes)`);
        console.log(`
Wire it into any MCP harness — this single command does everything:`);
        console.log(`  vortex-notes agent mcp '<token>'`);
      } else if (sub === "mcp") {
        const token = args.positional[1];
        if (!token) fail("Usage: vortex-notes agent mcp <token>");
        const r = await ensureAgentConnected(token);
        const { Vault: V } = await import("./vault.js");
        console.error(`[vortex-notes] agent "${r.name}" ${r.firstRun ? "bootstrapped" : "ready"} (${r.mode}) — vault ${r.vault}`);
        await startMcpServer(new V(r.vault), { readOnly: r.mode === "ro", watch: true });
      } else if (sub === "request") {
        const relay = args.flags.get("relay") as string;
        if (!relay) fail("Usage: vortex-notes agent request --relay <url> [--name <agent>]");
        const name = (args.flags.get("name") as string) ?? "agent";
        const { code, complete } = await requestPairing(relay, name);
        console.log(`Pairing code: ${code}`);
        console.log(`\nOn a machine that already has your notes, run:`);
        console.log(`  vortex-notes agent approve ${code} --space <name> --relay ${relay}`);
        console.log(`\nWaiting for approval (15 min)…`);
        const r = await complete();
        console.log(`\nPaired as "${r.name}". Vault: ${r.vault}`);
        console.log(`MCP for any harness: { "command": "vortex-notes", "args": ["mcp", "--vault", "${r.vault}"] }`);
      } else if (sub === "approve") {
        const code = args.positional[1];
        const relay = (args.flags.get("relay") as string) ?? DEFAULT_RELAY;
        const spacesArg = args.flags.get("space") as string;
        if (!code || !spacesArg) fail("Usage: vortex-notes agent approve <code> --space <name|id>[,<more>] [--relay <url>] [--read-only]");
        const mode = args.flags.has("read-only") ? ("ro" as const) : ("rw" as const);
        const record = await approvePairing(code.toUpperCase(), spacesArg.split(","), mode, relay);
        console.log(`Approved "${record.name}" (${mode === "ro" ? "read-only" : "read+write"}) for spaces: ${record.spaces.join(", ")}.`);
        console.log(`The agent's machine will finish setup by itself within a couple of seconds.`);
      } else if (sub === "list") {
        const agents = listAgents();
        if (!agents.length) {
          console.log("No agents created from this machine yet.");
          break;
        }
        for (const a of agents) {
          console.log(`${a.revokedAt ? "✗" : "✓"} ${a.name}  ${a.mode}  spaces: ${a.spaces.join(", ")}  key: ${a.signPub.slice(0, 12)}…${a.revokedAt ? `  (revoked ${a.revokedAt.slice(0, 10)})` : ""}`);
        }
      } else if (sub === "revoke") {
        const name = args.positional[1];
        const relay = args.flags.get("relay") as string;
        if (!name || !relay) fail("Usage: vortex-notes agent revoke <name> --relay <url>");
        const r = await revokeAgent(name, relay);
        console.log(`Agent "${r.name}" revoked: the relay no longer accepts its key, and its space grants were removed.`);
        console.log(`Note: it may retain previously-downloaded content and the old space key; key rotation on revoke lands next.`);
      } else {
        fail("Usage: vortex-notes agent <create|connect|list|revoke>");
      }
      break;
    }
    case "relay": {
      const { startRelay } = await import("./relay/server.js");
      const { port } = await startRelay({
        port: Number(args.flags.get("port") ?? 7300),
        dbPath: (args.flags.get("db") as string) ?? undefined,
      });
      console.log(`Vortex relay on :${port} — ciphertext store only, no keys, no plaintext.`);
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

/** Read a line from the terminal without echoing it (recovery phrases). */
async function promptHidden(question: string): Promise<string> {
  const { createInterface } = await import("node:readline");
  process.stderr.write(question);
  const rl = createInterface({ input: process.stdin, terminal: true });
  const wasRaw = process.stdin.isRaw;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.off("data", onData);
          if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false);
          rl.close();
          process.stderr.write("\n");
          resolve(value.trim());
          return;
        } else if (ch === "\u0003") { // Ctrl-C
          process.exit(130);
        } else if (ch === "\u007f" || ch === "\b") { // backspace
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

main().catch((err) => fail(`Error: ${(err as Error).message}`));
