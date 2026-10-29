import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wireHarnesses, launchCommand, stableNode, type Runner } from "../src/wire.js";
import { Vault } from "../src/vault.js";

function fakeRunner(installed: string[]) {
  const calls: string[][] = [];
  const run: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "which") return { status: installed.includes(args[0]) ? 0 : 1 };
    return { status: 0 };
  };
  return { run, calls };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vortex-wire-"));

test("launch command: npx cache path → npx; stable install → absolute node + script", () => {
  assert.deepEqual(launchCommand("/Users/x/.npm/_npx/abc/node_modules/vortex-notes/dist/cli.js", "/bin/node"), ["npx", "-y", "vortex-notes", "mcp"]);
  assert.deepEqual(launchCommand("/usr/lib/node_modules/vortex-notes/dist/cli.js", "/bin/node"), [
    "/bin/node",
    "/usr/lib/node_modules/vortex-notes/dist/cli.js",
    "mcp",
  ]);
});

test("wire: every harness found gets wired; Claude at user scope; Hermes without dash-flags in --args", () => {
  const dir = tmp();
  const oc = path.join(dir, "opencode.json");
  fs.writeFileSync(oc, JSON.stringify({ $schema: "x", model: "keep-me", mcp: { other: { type: "local", command: ["a"] } } }));
  const { run, calls } = fakeRunner(["hermes", "claude", "opencode"]);
  const results = wireHarnesses({ vault: "/v", cliPath: "/h/.npm/_npx/1/node_modules/vortex-notes/dist/cli.js", run, opencodeConfig: oc });
  assert.deepEqual(results.map((r) => [r.harness, r.ok]), [["Hermes", true], ["Claude Code", true], ["OpenCode", true]]);

  const hermesAdd = calls.find((c) => c[0] === "hermes" && c[2] === "add")!;
  assert.deepEqual(hermesAdd.slice(hermesAdd.indexOf("--args") + 1), ["vortex-notes", "mcp"]);
  assert.deepEqual(hermesAdd.slice(hermesAdd.indexOf("--env") + 1, hermesAdd.indexOf("--args")), ["VORTEX_NOTES_VAULT=/v", "npm_config_yes=true"]);

  const claudeAdd = calls.find((c) => c[0] === "claude" && c[2] === "add")!;
  assert.deepEqual(claudeAdd, ["claude", "mcp", "add", "vortex-notes", "--scope", "user", "--env", "VORTEX_NOTES_VAULT=/v", "--", "npx", "-y", "vortex-notes", "mcp"]);

  const cfg = JSON.parse(fs.readFileSync(oc, "utf8"));
  assert.equal(cfg.model, "keep-me");
  assert.ok(cfg.mcp.other, "other servers preserved");
  assert.deepEqual(cfg.mcp["vortex-notes"], {
    type: "local",
    enabled: true,
    command: ["npx", "-y", "vortex-notes", "mcp"],
    environment: { VORTEX_NOTES_VAULT: "/v" },
  });
});

test("wire: nothing installed → nothing touched; unparseable OpenCode config is left alone", () => {
  const dir = tmp();
  const { run, calls } = fakeRunner([]);
  assert.deepEqual(wireHarnesses({ vault: "/v", cliPath: "/x/cli.js", run, opencodeConfig: path.join(dir, "none.json") }), []);
  assert.ok(calls.every((c) => c[0] === "which"));

  const oc = path.join(dir, "opencode.json");
  fs.writeFileSync(oc, "{ // comment\n}");
  const [r] = wireHarnesses({ vault: "/v", cliPath: "/x/cli.js", run, opencodeConfig: oc });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(oc, "utf8"), "{ // comment\n}");
});

test("vault: ~ paths from shell-less MCP configs expand to the home dir", () => {
  assert.equal(Vault.resolve("~/VortexNotes").root, path.join(os.homedir(), "VortexNotes"));
  const prev = process.env.VORTEX_NOTES_VAULT;
  process.env.VORTEX_NOTES_VAULT = "~/x";
  try {
    assert.equal(Vault.resolve().root, path.join(os.homedir(), "x"));
  } finally {
    if (prev === undefined) delete process.env.VORTEX_NOTES_VAULT;
    else process.env.VORTEX_NOTES_VAULT = prev;
  }
});

test("node path: Homebrew Cellar path maps to the stable bin symlink when it exists", () => {
  const prefix = tmp();
  fs.mkdirSync(path.join(prefix, "bin"));
  fs.writeFileSync(path.join(prefix, "bin/node"), "");
  assert.equal(stableNode(`${prefix}/Cellar/node/25.2.1/bin/node`), `${prefix}/bin/node`);
  assert.equal(stableNode("/usr/local/bin/node"), "/usr/local/bin/node");
});
