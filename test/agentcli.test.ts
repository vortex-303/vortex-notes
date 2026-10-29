import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Vault } from "../src/vault.js";
import { startRelay } from "../src/relay/server.js";
import { initIdentity, loginIdentity } from "../src/identity.js";
import { linkVault, joinVault, syncVault } from "../src/sync.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** Run the CLI as an agent would: a fresh process, optional stdin. */
function cli(args: string[], env: Record<string, string> = {}, input?: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    input: input ?? "",
    encoding: "utf8",
    env: { ...process.env, VORTEX_NOTES_NO_SEMANTIC: "1", ...env },
    timeout: 60000,
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

/** Non-blocking variant for tests whose relay runs in this same process. */
function cliAsync(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, VORTEX_NOTES_NO_SEMANTIC: "1", ...env } });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.stdin.end();
    p.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

test("agent CLI: every MCP tool as a command, text and --json, stdin input, clean errors", () => {
  const vaultDir = tmp("vortex-cli-vault-");
  const home = tmp("vortex-cli-home-");
  const run = (args: string[], input?: string) => cli([...args, "--vault", vaultDir], { VORTEX_NOTES_HOME: home }, input);
  assert.equal(run(["init"]).code, 0);

  assert.equal(run(["write", "Kiln plan", "Cone 6, slow cool. See [[Clay]].", "--folder", "projects", "--tags", "kiln,studio"]).out, "Created projects/kiln-plan.md");
  assert.equal(run(["write", "Clay"], "B-mix stoneware\n").out, "Created clay.md"); // content from stdin
  assert.equal(run(["write", "Clay", "again"]).code, 1); // exists → edit instead

  assert.match(run(["edit", "projects/kiln-plan.md", "--append", "Shelf is 40cm."]).out, /append/);
  assert.match(run(["edit", "clay.md", "--find", "B-mix", "--replace", "Laguna B-mix"]).out, /find_replace/);
  assert.equal(run(["edit", "clay.md"]).code, 1);
  assert.match(run(["daily", "fired", "test", "tiles"]).out, /^Appended to daily\/\d{4}-\d{2}-\d{2}\.md$/);

  const first = JSON.parse(run(["remember", "Kiln max is cone 10", "--topic", "kiln", "--json"]).out);
  assert.equal(first.path, "memory/kiln.md");
  const second = JSON.parse(run(["remember", "Kiln max is cone 8", "--topic", "kiln", "--supersedes", first.id, "--json"]).out);
  assert.equal(second.superseded, first.id);

  const note = JSON.parse(run(["read", "projects/kiln-plan.md", "--json"]).out);
  assert.deepEqual(note.tags, ["kiln", "studio"]);
  assert.match(note.body, /Shelf is 40cm/);
  assert.match(run(["read", "clay.md"]).out, /^# Clay\npath: clay\.md\n\nLaguna B-mix stoneware/);

  assert.match(run(["search", "kiln", "shelf", "--keyword"]).out, /projects\/kiln-plan\.md/);
  const hits = JSON.parse(run(["search", "stoneware", "--keyword", "--json", "--limit", "1"]).out);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, "clay.md");
  assert.match(run(["context", "kiln", "--max", "1"]).out, /Context for: kiln/);
  assert.match(run(["recent"]).out, /memory\/kiln\.md/);
  assert.ok(JSON.parse(run(["list", "--json"]).out).includes("daily/" + new Date().toISOString().slice(0, 10) + ".md"));
  assert.equal(run(["list", "projects"]).out, "projects/kiln-plan.md");

  const missing = run(["read", "nope.md", "--json"]);
  assert.equal(missing.code, 1);
  assert.match(JSON.parse(missing.out).error, /No such note: nope\.md/);
  assert.equal(run(["daily", "x", "--read-only"]).code, 1);
  assert.equal(run(["recent", "--days", "zero"]).code, 1);
});

test("agent CLI: linked vault pulls before reading and pushes after writing", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const agentHome = tmp("vortex-cli-home-");
  const laptopHome = tmp("vortex-cli-home-");
  const prev = process.env.VORTEX_NOTES_HOME;
  try {
    const v1 = new Vault(tmp("vortex-cli-vault-"));
    v1.init();
    process.env.VORTEX_NOTES_HOME = agentHome;
    const { phrase } = initIdentity("agent-box");
    await linkVault(v1, base, "personal");
    await syncVault(v1);

    const v2 = new Vault(tmp("vortex-cli-vault-"));
    v2.init();
    process.env.VORTEX_NOTES_HOME = laptopHome;
    loginIdentity(phrase, "laptop");
    await joinVault(v2, base, phrase);
    await syncVault(v2);

    // agent writes via CLI → it's pushed; the laptop pulls it
    const env = { VORTEX_NOTES_HOME: agentHome };
    assert.equal((await cliAsync(["remember", "Supplier is Laguna", "--vault", v1.root], env)).code, 0);
    process.env.VORTEX_NOTES_HOME = laptopHome;
    await syncVault(v2);
    assert.match(fs.readFileSync(v2.abs("memory/facts.md"), "utf8"), /Supplier is Laguna/);

    // laptop writes → the agent's next CLI read sees it without a manual sync
    v2.writeNote("from-laptop.md", "From laptop", "Edited on the laptop.");
    await syncVault(v2);
    assert.match((await cliAsync(["read", "from-laptop.md", "--vault", v1.root], env)).out, /Edited on the laptop/);
    // --offline skips the network entirely
    v2.writeNote("later.md", "Later", "Not pulled offline.");
    await syncVault(v2);
    assert.equal((await cliAsync(["read", "later.md", "--offline", "--vault", v1.root], env)).code, 1);
  } finally {
    process.env.VORTEX_NOTES_HOME = prev;
    await relay.close();
  }
});

test("agent CLI: with no --vault it uses this machine's one paired vault", () => {
  const agents = tmp("vortex-cli-agents-");
  const dir = path.join(agents, "hermes-abc12345");
  fs.mkdirSync(path.join(dir, "home"), { recursive: true });
  fs.writeFileSync(path.join(dir, "home", "identity.json"), "{}");
  const vault = new Vault(path.join(dir, "vault"));
  vault.init();
  vault.writeNote("paired.md", "Paired", "Found without flags.");
  // A stale default vault (~/VortexNotes) must not shadow the paired one.
  const userHome = tmp("vortex-cli-userhome-");
  new Vault(path.join(userHome, "VortexNotes")).init();
  const env = { VORTEX_NOTES_AGENTS_DIR: agents, HOME: userHome, VORTEX_NOTES_VAULT: "" };
  const r = spawnSync(process.execPath, [CLI, "read", "paired.md"], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: { ...process.env, ...env, VORTEX_NOTES_NO_SEMANTIC: "1", VORTEX_NOTES_HOME: "" },
  });
  assert.match(r.stdout, /Found without flags/);
});
