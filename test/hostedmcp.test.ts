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

// Secret-URL connectors need no OAuth; probes other than our own discovery
// documents get a plain 404 (a 401 there makes clients insist on signing in).
test("hosted MCP: other discovery probes are a plain 404, not 401", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    for (const p of [
      "/.well-known/openid-configuration",
      `/mcp/${"a".repeat(64)}/.well-known/oauth-protected-resource`,
    ]) {
      assert.equal((await fetch(base + p)).status, 404, p);
    }
  } finally {
    await relay.close();
  }
});

// OAuth sign-in on the one shared /mcp URL: what Claude/ChatGPT do when you add
// https://…/mcp with "Sign in". Approval is the web app binding a connector.
test("OAuth: register → authorize → approve → token → /mcp; PKCE, single-use codes, rotation, revoke", async () => {
  const { createHash, randomBytes } = await import("node:crypto");
  const relay = await startRelay({ port: 0, connectorKek: randomKey() });
  const base = `http://127.0.0.1:${relay.port}`;
  const prevHome = process.env.VORTEX_NOTES_HOME;
  process.env.VORTEX_NOTES_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-oauth-home-"));
  const b64url = (b: Buffer) => b.toString("base64url");
  const form = (o: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
  try {
    initIdentity("owners-mac");
    const vault = new Vault(fs.mkdtempSync(path.join(os.tmpdir(), "vortex-oauth-vault-")));
    vault.init();
    vault.writeNote("secret.md", "Secret", "launch code is 4417");
    await linkVault(vault, base, "personal");
    await syncVault(vault);
    const spaceId = loadSyncState(vault)!.spaceId;

    // discovery
    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json() as any;
    assert.equal(prm.resource, `${base}/mcp`);
    const asm = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json() as any;
    assert.deepEqual(asm.code_challenge_methods_supported, ["S256"]);
    const noAuth = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    assert.equal(noAuth.status, 401);
    assert.match(noAuth.headers.get("www-authenticate") ?? "", /resource_metadata="[^"]+oauth-protected-resource"/);

    // registration: https or loopback only
    assert.equal((await fetch(`${base}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) })).status, 400);
    const redirect = "https://claude.ai/api/mcp/auth_callback";
    const reg = await (await fetch(`${base}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }) })).json() as any;
    const clientId = reg.client_id as string;

    // a wrong redirect never bounces anywhere
    const wrong = await fetch(`${base}/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&code_challenge=x&code_challenge_method=S256`, { redirect: "manual" });
    assert.equal(wrong.status, 400);

    /** One full browser round: authorize → (user approves in the app) → code. */
    const signIn = async (verifier: string) => {
      const challenge = b64url(createHash("sha256").update(verifier).digest());
      const auth = await fetch(`${base}/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`, { redirect: "manual" });
      assert.equal(auth.status, 302);
      const reqId = new URL(auth.headers.get("location")!, base).searchParams.get("oauth")!;
      const info = await (await fetch(`${base}/v1/oauth/request/${reqId}`)).json() as any;
      assert.equal(info.clientName, "Claude");
      assert.equal(info.redirectHost, "claude.ai");
      const { url, signPub, client } = await createCloudAgent(base, spaceId, "rw");
      const { redirect: back } = await client.approveOAuth(reqId, url.split("/mcp/")[1]);
      const u = new URL(back);
      assert.equal(u.origin + u.pathname, redirect);
      assert.equal(u.searchParams.get("state"), "xyz");
      return { code: u.searchParams.get("code")!, signPub, client };
    };

    // wrong PKCE verifier fails, and burns the code
    const v1 = b64url(randomBytes(32));
    const first = await signIn(v1);
    const badPkce = await fetch(`${base}/oauth/token`, form({ grant_type: "authorization_code", code: first.code, redirect_uri: redirect, client_id: clientId, code_verifier: b64url(randomBytes(32)) }));
    assert.equal(badPkce.status, 400);
    const burnt = await fetch(`${base}/oauth/token`, form({ grant_type: "authorization_code", code: first.code, redirect_uri: redirect, client_id: clientId, code_verifier: v1 }));
    assert.equal((await burnt.json() as any).error, "invalid_grant");

    // the real thing
    const v2 = b64url(randomBytes(32));
    const second = await signIn(v2);
    const tok = await (await fetch(`${base}/oauth/token`, form({ grant_type: "authorization_code", code: second.code, redirect_uri: redirect, client_id: clientId, code_verifier: v2 }))).json() as any;
    assert.equal(tok.token_type, "Bearer");
    const reused = await fetch(`${base}/oauth/token`, form({ grant_type: "authorization_code", code: second.code, redirect_uri: redirect, client_id: clientId, code_verifier: v2 }));
    assert.equal(reused.status, 400, "codes are single-use");

    const callMcp = async (access: string, method: string, params: unknown = {}) => {
      const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return { status: r.status, body: (await r.json().catch(() => null)) as any };
    };
    const read = await callMcp(tok.access_token, "tools/call", { name: "read_note", arguments: { path: "secret.md" } });
    assert.equal(read.status, 200);
    assert.match(toolText(read), /4417/);
    assert.equal((await callMcp("f".repeat(64), "tools/list")).status, 401);

    // refresh rotates: the old refresh token stops working
    const refreshed = await (await fetch(`${base}/oauth/token`, form({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: clientId }))).json() as any;
    assert.ok(refreshed.access_token && refreshed.refresh_token !== tok.refresh_token);
    assert.equal((await fetch(`${base}/oauth/token`, form({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: clientId }))).status, 400);
    assert.equal((await callMcp(refreshed.access_token, "tools/list")).status, 200);

    // revoke in Agents & devices → tokens dead, refresh refused
    await second.client.revokePrincipal(second.signPub);
    assert.equal((await callMcp(refreshed.access_token, "tools/list")).status, 401);
    assert.equal((await fetch(`${base}/oauth/token`, form({ grant_type: "refresh_token", refresh_token: refreshed.refresh_token, client_id: clientId }))).status, 400);
  } finally {
    process.env.VORTEX_NOTES_HOME = prevHome;
    await relay.close();
  }
});

// Directory listings link these; the ChatGPT domain check needs its token served verbatim.
test("relay serves /privacy, /terms and the optional OpenAI domain-check token", async () => {
  const relay = await startRelay({ port: 0, openaiAppsChallenge: "tok-123" });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    assert.match(await (await fetch(`${base}/privacy`)).text(), /chat connector/);
    assert.match(await (await fetch(`${base}/terms`)).text(), /Terms of use/);
    assert.equal(await (await fetch(`${base}/.well-known/openai-apps-challenge`)).text(), "tok-123");
    const tools = await (await fetch(`${base}/privacy`)).headers.get("content-type");
    assert.match(tools ?? "", /text\/html/);
  } finally {
    await relay.close();
  }
});

test("every MCP tool has a title and a read-only or destructive hint (directory requirement)", async () => {
  const { createHostedMcp } = await import("../src/relay/hostedmcp.js");
  const h = createHostedMcp({ pull: () => [], push: () => 1 });
  const out = h.rpc({ spaceId: "s", spaceKey: new Uint8Array(32), readOnly: false }, { jsonrpc: "2.0", id: 1, method: "tools/list" }) as any;
  assert.equal(out.result.tools.length, 9);
  for (const t of out.result.tools) {
    assert.ok(t.title, `${t.name} has a title`);
    assert.ok(typeof t.annotations?.readOnlyHint === "boolean" || typeof t.annotations?.destructiveHint === "boolean", `${t.name} has a hint`);
    assert.ok(t.name.length <= 64);
  }
});

test("self-host: relay settings come from the environment (as `vortex-notes relay` reads them)", async () => {
  const { relayOptionsFromEnv } = await import("../src/relay/server.js");
  const o = relayOptionsFromEnv({ RELAY_CONNECTOR_KEK: "ab".repeat(32), RELAY_QUOTA_MB: "5", RELAY_ADMIN_ACCOUNT: "acct" });
  assert.equal(o.connectorKek?.length, 32);
  assert.equal(o.quotaBytes, 5e6);
  assert.equal(o.adminAccount, "acct");
  assert.equal(relayOptionsFromEnv({}).connectorKek, undefined);
  assert.throws(() => relayOptionsFromEnv({ RELAY_CONNECTOR_KEK: "short" }), /64 hex/);
});

// App Store requirement and the privacy page's promise: an account can delete itself.
test("account deletion removes every row the relay holds for the account", async () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vortex-delete-")), "relay.db");
  const relay = await startRelay({ port: 0, dbPath, connectorKek: randomKey() });
  const base = `http://127.0.0.1:${relay.port}`;
  const prevHome = process.env.VORTEX_NOTES_HOME;
  process.env.VORTEX_NOTES_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-delete-home-"));
  try {
    initIdentity("owners-mac");
    const vault = new Vault(fs.mkdtempSync(path.join(os.tmpdir(), "vortex-delete-vault-")));
    vault.init();
    vault.writeNote("secret.md", "Secret", "launch code is 4417");
    await linkVault(vault, base, "personal");
    await syncVault(vault);
    const spaceId = loadSyncState(vault)!.spaceId;
    const { url, client } = await createCloudAgent(base, spaceId, "rw");
    const account = loadIdentity().file.accountSignPub;

    // An explicit confirmation is required.
    const unconfirmed = await fetch(`${base}/v1/account`, { method: "DELETE" });
    assert.equal(unconfirmed.status, 401, "unsigned requests never reach it");

    const { deleted } = await client.deleteAccount();
    assert.ok(deleted.updates >= 1 && deleted.spaces === 1 && deleted.connectors === 1 && deleted.principals >= 2);

    // Nothing left for the account, the connector URL is dead, the device can't sign in.
    assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 404);
    await assert.rejects(() => client.listSpaces());
    const db = new Database(dbPath, { readonly: true });
    const count = (q: string, ...p: unknown[]) => (db.prepare(q).get(...p) as { n: number }).n;
    assert.equal(count("SELECT COUNT(*) n FROM devices WHERE account=?", account), 0);
    assert.equal(count("SELECT COUNT(*) n FROM spaces WHERE account=?", account), 0);
    assert.equal(count("SELECT COUNT(*) n FROM updates WHERE space=?", spaceId), 0);
    assert.equal(count("SELECT COUNT(*) n FROM connectors WHERE account=?", account), 0);
    assert.equal(count("SELECT COUNT(*) n FROM accounts WHERE account=?", account), 0);
    assert.equal(count("SELECT COUNT(*) n FROM oauth_tokens"), 0);
    db.close();
  } finally {
    process.env.VORTEX_NOTES_HOME = prevHome;
    await relay.close();
  }
});
