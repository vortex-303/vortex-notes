import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Vault } from "../src/vault.js";
import { startRelay } from "../src/relay/server.js";
import { initIdentity } from "../src/identity.js";
import { linkVault, syncVault } from "../src/sync.js";
import { createAgent, connectAgent, listAgents, revokeAgent } from "../src/agents.js";
import { RelayClient } from "../src/relay/client.js";
import { loadIdentity } from "../src/identity.js";

process.env.VORTEX_NOTES_NO_SEMANTIC = "1";

function newHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vortex-agent-home-"));
}
async function as<T>(home: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env.VORTEX_NOTES_HOME;
  process.env.VORTEX_NOTES_HOME = home;
  try {
    return await fn();
  } finally {
    process.env.VORTEX_NOTES_HOME = prev;
  }
}
function freshVault(): Vault {
  const vault = new Vault(fs.mkdtempSync(path.join(os.tmpdir(), "vortex-agent-vault-")));
  vault.init();
  fs.rmSync(vault.abs("Welcome.md"));
  return vault;
}

test("agent lifecycle: create → connect → scoped sync both ways → attribution → revoke", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const owner = newHome();
  const agentBox = newHome();
  try {
    const userVault = freshVault();
    // owner: identity, two spaces (one granted, one private), notes
    const token = await as(owner, async () => {
      initIdentity("owners-mac");
      userVault.writeNote("brief.md", "Brief", "The agent should read this.");
      await linkVault(userVault, base, "work");
      await syncVault(userVault);
      // second, private space the agent must never see
      const { createSpace } = await import("../src/spaces.js");
      const priv = createSpace(loadIdentity(), "private-journal");
      const client = new RelayClient(base, loadIdentity());
      await client.createSpace(priv);

      const { token, record } = await createAgent("hermes", ["work"], "rw", base);
      assert.equal(record.mode, "rw");
      assert.equal(listAgents().length, 1);
      return token;
    });

    // agent machine: one token → identity + vault + notes
    const agentVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-agent-v-"));
    await as(agentBox, async () => {
      const r = await connectAgent(token, agentVaultDir);
      assert.equal(r.name, "hermes");
      assert.equal(r.spaces.length, 1, "agent sees only the granted space");

      const agentVault = new Vault(agentVaultDir);
      const pull = await syncVault(agentVault);
      assert.ok(pull.pulled >= 1);
      assert.match(fs.readFileSync(agentVault.abs("brief.md"), "utf8"), /agent should read this/);

      // agent writes a note back
      agentVault.writeNote("report.md", "Report", "Filed by hermes.");
      await syncVault(agentVault);

      // scoping: the private space is invisible and untouchable
      const agentIdentity = loadIdentity();
      const c = new RelayClient(base, agentIdentity);
      const visible = await c.listSpaces();
      assert.equal(visible.length, 1);
      await assert.rejects(c.pushUpdate("sp-fake00000000000000000000", "x", new Uint8Array([1])), /Unknown space|not granted/);
    });

    // owner pulls: agent's note arrives, and the relay attributes it to the agent's key
    await as(owner, async () => {
      await syncVault(userVault);
      assert.match(fs.readFileSync(userVault.abs("report.md"), "utf8"), /Filed by hermes/);
      const client = new RelayClient(base, loadIdentity());
      const principals = await client.listPrincipals();
      const hermes = principals.find((p) => p.kind === "agent");
      assert.ok(hermes);
      assert.equal(hermes!.name, "hermes");
      const { getSpace } = await import("../src/spaces.js");
      const updates = await client.pullUpdates(getSpace("work").id);
      const report = updates.filter((u) => u.doc === "report.md").pop();
      assert.equal(report!.author, hermes!.signPub, "agent edits are signed by the agent, not the owner");

      // revoke: relay stops accepting the agent entirely
      await revokeAgent("hermes", base);
      assert.ok(listAgents()[0].revokedAt);
    });
    await as(agentBox, async () => {
      const c = new RelayClient(base, loadIdentity());
      await assert.rejects(c.listSpaces(), /not registered/i);
    });
  } finally {
    await relay.close();
  }
});

test("single-command bootstrap: ensureAgentConnected derives paths, is idempotent", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const owner = newHome();
  try {
    const v = freshVault();
    const token = await as(owner, async () => {
      initIdentity("mac");
      v.writeNote("hello.md", "Hello", "for the one-command agent");
      await linkVault(v, base, "work");
      await syncVault(v);
      return (await createAgent("solo", ["work"], "rw", base)).token;
    });

    // simulate the agent machine: derived home/vault under a temp agents dir
    const prevHome = process.env.VORTEX_NOTES_HOME;
    const prevDir = process.env.VORTEX_NOTES_AGENTS_DIR;
    delete process.env.VORTEX_NOTES_HOME;
    process.env.VORTEX_NOTES_AGENTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-agents-dir-"));
    try {
      const { ensureAgentConnected } = await import("../src/agents.js");
      const first = await ensureAgentConnected(token);
      assert.equal(first.firstRun, true);
      assert.match(first.vault, /solo-/);
      const pull = await syncVault(new Vault(first.vault));
      assert.ok(pull.pulled >= 1);
      assert.match(fs.readFileSync(path.join(first.vault, "hello.md"), "utf8"), /one-command agent/);

      // second run: reuses everything
      delete process.env.VORTEX_NOTES_HOME;
      const second = await ensureAgentConnected(token);
      assert.equal(second.firstRun, false);
      assert.equal(second.vault, first.vault);
    } finally {
      process.env.VORTEX_NOTES_HOME = prevHome;
      if (prevDir === undefined) delete process.env.VORTEX_NOTES_AGENTS_DIR;
      else process.env.VORTEX_NOTES_AGENTS_DIR = prevDir;
    }
  } finally {
    await relay.close();
  }
});

test("pairing: agent requests with a short code, owner approves, keys never travel", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const owner = newHome();
  try {
    const v = freshVault();
    await as(owner, async () => {
      initIdentity("mac");
      v.writeNote("paired.md", "Paired", "hello paired agent");
      await linkVault(v, base, "work");
      await syncVault(v);
    });

    // agent machine: no identity, no token — just a code
    const prevHome = process.env.VORTEX_NOTES_HOME;
    const prevDir = process.env.VORTEX_NOTES_AGENTS_DIR;
    delete process.env.VORTEX_NOTES_HOME;
    process.env.VORTEX_NOTES_AGENTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-pair-agents-"));
    try {
      const { requestPairing } = await import("../src/agents.js");
      const { code, complete } = await requestPairing(base, "paired-bot");
      assert.match(code, /^[A-Z2-9]{6}$/);

      // owner approves from their machine (read-only grant)
      await as(owner, async () => {
        const { approvePairing } = await import("../src/agents.js");
        const record = await approvePairing(code, ["work"], "ro", base);
        assert.equal(record.name, "paired-bot");
        assert.equal(record.mode, "ro");
      });

      const done = await complete({ intervalMs: 50, timeoutMs: 10_000 });
      assert.equal(done.name, "paired-bot");
      const agentVault = new Vault(done.vault);
      const pull = await syncVault(agentVault);
      assert.ok(pull.pulled >= 1);
      assert.match(fs.readFileSync(agentVault.abs("paired.md"), "utf8"), /hello paired agent/);

      // read-only is enforced end to end
      agentVault.writeNote("nope.md", "Nope", "should be rejected");
      await assert.rejects(syncVault(agentVault), /read-only/i);

      // the code is consumed: polling again 404s
      const res = await fetch(`${base}/v1/pair/poll?code=${code}&signPub=${"0".repeat(64)}`);
      assert.equal(res.status, 404);
    } finally {
      process.env.VORTEX_NOTES_HOME = prevHome;
      if (prevDir === undefined) delete process.env.VORTEX_NOTES_AGENTS_DIR;
      else process.env.VORTEX_NOTES_AGENTS_DIR = prevDir;
    }
  } finally {
    await relay.close();
  }
});

test("read-only agent: relay rejects its writes; forged agent certs are rejected", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const owner = newHome();
  const agentBox = newHome();
  try {
    const v = freshVault();
    const token = await as(owner, async () => {
      initIdentity("mac");
      v.writeNote("data.md", "Data", "read me");
      await linkVault(v, base, "work");
      await syncVault(v);
      return (await createAgent("watcher", ["work"], "ro", base)).token;
    });

    await as(agentBox, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-ro-v-"));
      await connectAgent(token, dir);
      const vault = new Vault(dir);
      const r = await syncVault(vault);
      assert.ok(r.pulled >= 1, "read-only agent can pull");
      // any push is rejected by the relay
      vault.writeNote("sneaky.md", "Sneaky", "should not land");
      await assert.rejects(syncVault(vault), /read-only/i);
    });

    // forged chain: an agent cert signed by a random key that ISN'T a certified device
    await as(newHome(), async () => {
      const { certifyAgent } = await import("../src/account.js");
      const { randomSignKeypair, randomBoxKeypair, toHex } = await import("../src/crypto.js");
      const rogueDevice = randomSignKeypair();
      const aSign = randomSignKeypair();
      const aBox = randomBoxKeypair();
      const forged = certifyAgent(rogueDevice, aSign.pub, aBox.pub, "evil", ["work"], "rw");
      const ownerIdentity = await as(owner, () => loadIdentity());
      const res = await fetch(`${base}/v1/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountSignPub: ownerIdentity.file.accountSignPub,
          accountEncPub: ownerIdentity.file.accountEncPub,
          device: forged,
          chain: { ...ownerIdentity.file.device, signPub: toHex(rogueDevice.pub) }, // tampered chain
        }),
      });
      assert.equal(res.status, 401);
    });
  } finally {
    await relay.close();
  }
});
