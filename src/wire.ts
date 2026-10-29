/**
 * Wire a paired vault into every agent harness found on this machine
 * (Hermes, Claude Code, OpenCode). The vault is always pinned via
 * VORTEX_NOTES_VAULT so a server can never drift to another vault.
 *
 * Launch command: when the CLI runs from npx's cache (`npx vortex-notes pair`)
 * that path disappears on the next cache clean, so harnesses get
 * `npx vortex-notes mcp` instead; a global install / checkout uses its own
 * absolute node + script paths (no PATH surprises).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type Runner = (cmd: string, args: string[], input?: string) => { status: number | null };

const defaultRunner: Runner = (cmd, args, input) =>
  spawnSync(cmd, args, { input, encoding: "utf8", timeout: 30000 });

export interface WireOptions {
  vault: string;
  /** realpath of the running CLI script */
  cliPath: string;
  nodePath?: string;
  run?: Runner;
  /** OpenCode config file (default ~/.config/opencode/opencode.json) */
  opencodeConfig?: string;
}

export interface WireResult {
  harness: "Hermes" | "Claude Code" | "OpenCode";
  ok: boolean;
  note: string;
}

/** Homebrew's execPath is versioned (…/Cellar/node/25.2.1/bin/node) and dies on upgrade; use its stable symlink. */
export function stableNode(execPath = process.execPath): string {
  const m = execPath.match(/^(.*)\/Cellar\/node(?:@[^/]+)?\/[^/]+\/bin\/node$/);
  return m && fs.existsSync(`${m[1]}/bin/node`) ? `${m[1]}/bin/node` : execPath;
}

export function launchCommand(cliPath: string, nodePath = stableNode()): string[] {
  return cliPath.includes(`${path.sep}_npx${path.sep}`) ? ["npx", "-y", "vortex-notes", "mcp"] : [nodePath, cliPath, "mcp"];
}

export function wireHarnesses(opts: WireOptions): WireResult[] {
  const run = opts.run ?? defaultRunner;
  const [cmd, ...args] = launchCommand(opts.cliPath, opts.nodePath);
  const vaultEnv = `VORTEX_NOTES_VAULT=${opts.vault}`;
  const results: WireResult[] = [];
  const has = (bin: string) => run("which", [bin]).status === 0;

  if (has("hermes")) {
    // Hermes' argparse swallows dash-flags inside --args, so npx gets its
    // auto-yes via env instead of -y.
    const hermesArgs = cmd === "npx" ? args.filter((a) => a !== "-y") : args;
    // `--env A=1 B=2` (nargs) — a repeated --env would replace, not add.
    const env = cmd === "npx" ? ["--env", vaultEnv, "npm_config_yes=true"] : ["--env", vaultEnv];
    run("hermes", ["mcp", "remove", "vortex-notes"]); // never leave a stale entry behind
    const r = run("hermes", ["mcp", "add", "vortex-notes", "--command", cmd, ...env, "--args", ...hermesArgs], "Y\n");
    results.push({ harness: "Hermes", ok: r.status === 0, note: r.status === 0 ? "type /reload-mcp in your Hermes chat" : "`hermes mcp add` failed" });
  }

  if (has("claude")) {
    // User scope = every project; a leftover local-scope entry would shadow it.
    run("claude", ["mcp", "remove", "vortex-notes", "--scope", "local"]);
    run("claude", ["mcp", "remove", "vortex-notes", "--scope", "user"]);
    const r = run("claude", ["mcp", "add", "vortex-notes", "--scope", "user", "--env", vaultEnv, "--", cmd, ...args]);
    results.push({ harness: "Claude Code", ok: r.status === 0, note: r.status === 0 ? "available in every project (restart open sessions)" : "`claude mcp add` failed" });
  }

  const ocFile = opts.opencodeConfig ?? path.join(os.homedir(), ".config", "opencode", "opencode.json");
  if (has("opencode") || fs.existsSync(ocFile)) {
    results.push(wireOpenCode(ocFile, [cmd, ...args], opts.vault));
  }
  return results;
}

function wireOpenCode(file: string, command: string[], vault: string): WireResult {
  let config: Record<string, unknown> = { $schema: "https://opencode.ai/config.json" };
  if (fs.existsSync(file)) {
    try {
      config = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return { harness: "OpenCode", ok: false, note: `${file} isn't plain JSON (comments?) — add the entry by hand` };
    }
  }
  const mcp = (config.mcp ?? {}) as Record<string, unknown>;
  mcp["vortex-notes"] = { type: "local", enabled: true, command, environment: { VORTEX_NOTES_VAULT: vault } };
  config.mcp = mcp;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.vortex-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return { harness: "OpenCode", ok: true, note: "restart OpenCode" };
}

/** Copy-paste wiring for anything we couldn't (or didn't) wire automatically. */
export function manualWiring(cliPath: string, vault: string, nodePath?: string): string[] {
  const command = launchCommand(cliPath, nodePath);
  return [
    `  Claude Code: claude mcp add vortex-notes --scope user --env VORTEX_NOTES_VAULT=${vault} -- ${command.join(" ")}`,
    `  OpenCode:    "mcp": { "vortex-notes": { "type": "local", "enabled": true, "command": ${JSON.stringify(command)}, "environment": { "VORTEX_NOTES_VAULT": "${vault}" } } }`,
    `  Any MCP:     { "command": "${command[0]}", "args": ${JSON.stringify(command.slice(1))}, "env": { "VORTEX_NOTES_VAULT": "${vault}" } }`,
  ];
}
