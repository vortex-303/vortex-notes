import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Vault } from "../src/vault.js";
import { startRelay } from "../src/relay/server.js";
import { initIdentity, loadIdentity } from "../src/identity.js";
import { linkVault, syncVault, loadSyncState } from "../src/sync.js";
import { getSpace, openSpaceKey, grantSpace } from "../src/spaces.js";
import { certifyAgent } from "../src/account.js";
import { RelayClient } from "../src/relay/client.js";
import { randomSignKeypair, randomBoxKeypair, randomKey, toHex } from "../src/crypto.js";

process.env.VORTEX_NOTES_NO_SEMANTIC = "1";

/** What the web app's "Connect a chat app" does, from the owner's device. */
async function createCloudAgent(base: string, spaceId: string, mode: "ro" | "rw", keysOverride?: Uint8Array) {
  const identity = loadIdentity();
  const sign = randomSignKeypair();
  const box = randomBoxKeypair();
  const cert = certifyAgent(identity.deviceSign, sign.pub, box.pub, "Claude.ai", [spaceId], mode);
  const space = getSpace(spaceId);
  grantSpace(space, openSpaceKey(identity, space), cert.signPub, box.pub);
  const client = new RelayClient(base, identity);
  await client.createSpace(getSpace(spaceId));
  await fetch(`${base}/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountSignPub: identity.file.accountSignPub, accountEncPub: identity.file.accountEncPub, device: cert, chain: identity.file.device }),
  });
  const keys = new Uint8Array(64);
  keys.set(sign.priv, 0);
  keys.set(box.priv, 32);
  const { path: mcpPath } = await client.createConnector(cert.signPub, keysOverride ?? keys);
  return { url: base + mcpPath, signPub: cert.signPub, client };
}

function mcp(url: string) {
  let id = 0;
  return async (method: string, params: unknown = {}) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
}
const toolText = (r: { body: any }) => r.body.result.content[0].text as string;

test("hosted MCP: a cloud agent reads, searches and writes; writes sync back E2E; revoke kills the URL", async () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vortex-hosted-")), "relay.db");
  const kek = randomKey();
  const relay = await startRelay({ port: 0, dbPath, connectorKek: kek });
  const base = `http://127.0.0.1:${relay.port}`;
  const prevHome = process.env.VORTEX_NOTES_HOME;
  process.env.VORTEX_NOTES_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-hosted-home-"));
  try {
    initIdentity("owners-mac");
    const vault = new Vault(fs.mkdtempSync(path.join(os.tmpdir(), "vortex-hosted-vault-")));
    vault.init();
    fs.rmSync(vault.abs("Welcome.md"));
    vault.writeNote("projects/kiln.md", "Kiln build", "Firing schedule: cone 6, slow cool. See [[Clay notes]].");
    vault.writeNote("clay.md", "Clay notes", "B-mix stoneware from the shop.");
    await linkVault(vault, base, "personal");
    await syncVault(vault);
    const spaceId = loadSyncState(vault)!.spaceId;

    const { url, signPub, client } = await createCloudAgent(base, spaceId, "rw");
    const call = mcp(url);

    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(init.body.result.protocolVersion, "2025-06-18");
    assert.equal(init.body.result.serverInfo.name, "vortex-notes");
    const note = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    assert.equal(note.status, 202);

    const tools = (await call("tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    assert.ok(tools.includes("remember") && tools.includes("search_notes"));

    assert.match(toolText(await call("tools/call", { name: "search_notes", arguments: { query: "firing schedule" } })), /projects\/kiln\.md/);
    assert.match(toolText(await call("tools/call", { name: "read_note", arguments: { path: "projects/kiln.md" } })), /cone 6/);
    assert.match(toolText(await call("tools/call", { name: "build_context", arguments: { topic: "kiln" } })), /clay\.md — Clay notes/);

    assert.match(toolText(await call("tools/call", { name: "remember", arguments: { fact: "Kiln shelf is 40cm", topic: "kiln" } })), /memory\/kiln\.md/);
    assert.match(toolText(await call("tools/call", { name: "edit_note", arguments: { path: "clay.md", operation: "append", content: "Order more in May." } })), /Updated/);
    const bad = await call("tools/call", { name: "read_note", arguments: { path: "../etc/passwd" } });
    assert.equal(bad.body.result.isError, true);

    // The agent's writes are ordinary E2E updates: the owner's vault pulls them.
    const r = await syncVault(vault);
    assert.equal(r.pulled, 2);
    assert.match(fs.readFileSync(vault.abs("memory/kiln.md"), "utf8"), /Kiln shelf is 40cm/);
    assert.match(fs.readFileSync(vault.abs("clay.md"), "utf8"), /Order more in May/);

    // And the owner's later edits reach the agent.
    vault.updateNote("projects/kiln.md", "Firing schedule: cone 10 now.");
    await syncVault(vault);
    assert.match(toolText(await call("tools/call", { name: "read_note", arguments: { path: "projects/kiln.md" } })), /cone 10/);

    // Keys at rest are encrypted under the KEK, never the raw seeds.
    const db = new Database(dbPath, { readonly: true });
    const stored = (db.prepare("SELECT keys FROM connectors").get() as { keys: string }).keys;
    db.close();
    assert.ok(stored.startsWith("k1:"));

    // Read-only connector: no write tools, writes refused.
    const ro = mcp((await createCloudAgent(base, spaceId, "ro")).url);
    const roTools = (await ro("tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    assert.ok(!roTools.includes("write_note") && roTools.includes("read_note"));
    assert.equal((await ro("tools/call", { name: "append_daily", arguments: { content: "x" } })).body.result.isError, true);

    // Revoking the agent kills the URL and the held keys.
    await client.revokePrincipal(signPub);
    assert.equal((await call("tools/list")).status, 404);
    assert.equal((await fetch(url)).status, 404);
  } finally {
    process.env.VORTEX_NOTES_HOME = prevHome;
    await relay.close();
  }
});

test("hosted MCP: the relay refuses keys that don't belong to the agent", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const prevHome = process.env.VORTEX_NOTES_HOME;
  process.env.VORTEX_NOTES_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-hosted-home-"));
  try {
    initIdentity("owners-mac");
    const vault = new Vault(fs.mkdtempSync(path.join(os.tmpdir(), "vortex-hosted-vault-")));
    vault.init();
    await linkVault(vault, base, "personal");
    const spaceId = loadSyncState(vault)!.spaceId;
    await assert.rejects(createCloudAgent(base, spaceId, "rw", new Uint8Array(64).fill(7)), /don't match/);
    assert.equal((await fetch(`${base}/mcp/${toHex(new Uint8Array(32))}`, { method: "POST", body: "{}" })).status, 404);
  } finally {
    process.env.VORTEX_NOTES_HOME = prevHome;
    await relay.close();
  }
});

// ChatGPT/Claude probe OAuth discovery before connecting; a 401 there makes them
// insist on OAuth. These connectors use the secret URL instead, so: plain 404.
test("hosted MCP: OAuth discovery paths say 'no OAuth here' (404, not 401)", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    for (const p of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration",
      `/.well-known/oauth-protected-resource/mcp/${"a".repeat(64)}`,
      `/mcp/${"a".repeat(64)}/.well-known/oauth-protected-resource`,
    ]) {
      assert.equal((await fetch(base + p)).status, 404, p);
    }
  } finally {
    await relay.close();
  }
});
