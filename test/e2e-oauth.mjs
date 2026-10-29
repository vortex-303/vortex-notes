// Browser E2E: a chat app adds the one shared /mcp URL and signs in over OAuth.
// We play the chat app (register, authorize with PKCE, token exchange) and the
// user (the consent screen in the real web app). Then the token reads a note
// over /mcp, and Cancel sends the browser back with access_denied.
import { chromium } from "playwright";
import { createHash, randomBytes } from "node:crypto";
import { relayTarget } from "./relay-target.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const relay = await relayTarget();
const base = relay.base;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept("Launch"));
let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };

const REDIRECT = "https://chat.example/oauth/callback";
let landed = null;
await page.route("https://chat.example/**", (r) => { landed = r.request().url(); return r.fulfill({ body: "back in the chat app" }); });

const b64url = (b) => b.toString("base64url");
async function authorizeUrl(clientId) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
  return { url: `${base}/oauth/authorize?${q}`, verifier };
}

try {
  // the user has an account with one note
  await page.goto(`${base}/app`);
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });
  await page.click("#newBtn");
  await page.waitForSelector("#cm .cm-content", { timeout: 10000 });
  await page.click("#cm .cm-content");
  await page.keyboard.type("launch code is 4417");
  await page.waitForTimeout(2500); // autosave + push

  // the chat app registers itself
  const reg = await (await fetch(`${base}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Test Chat", redirect_uris: [REDIRECT] }) })).json();
  check("dynamic registration returns a client_id", /^vnc_/.test(reg.client_id));

  // sign-in → consent screen in the web app (already signed in on this browser)
  const a = await authorizeUrl(reg.client_id);
  await page.goto(a.url);
  await page.waitForSelector("#oauthOverlay:not([hidden])", { timeout: 15000 });
  check("consent names the app", (await page.textContent("#oauthApp")) === "Test Chat");
  check("consent shows where it returns", (await page.textContent("#oauthHost")) === "chat.example");
  check("the ?oauth= id is dropped from the address bar", !page.url().includes("oauth="));
  await page.click("#oauthApprove");
  for (let i = 0; i < 50 && !landed; i++) await page.waitForTimeout(200);
  const back = landed ? new URL(landed) : null;
  check("approve returns to the app with code + state", !!back?.searchParams.get("code") && back.searchParams.get("state") === "s1");

  // the chat app swaps the code and calls /mcp
  const tok = await (await fetch(`${base}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code"), redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: a.verifier }) })).json();
  check("token exchange returns a bearer token", tok.token_type === "Bearer");
  const mcp = async (method, params = {}) => (await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
  const found = await mcp("tools/call", { name: "search_notes", arguments: { query: "launch code" } });
  check("the signed-in app finds the note over /mcp", /4417|launch/i.test(JSON.stringify(found)));

  // it shows up under Agents & devices as that app
  await page.goto(`${base}/app`);
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });
  await page.click("#userBtn");
  await page.click("#agentsBtn");
  await page.waitForFunction(() => /Test Chat/.test(document.querySelector("#agentsList")?.textContent ?? ""), null, { timeout: 10000 });
  check("Agents & devices lists the app as a chat connector", /chat connector/.test(await page.textContent("#agentsList")));

  // Cancel goes back with access_denied and creates nothing
  landed = null;
  const c = await authorizeUrl(reg.client_id);
  await page.goto(c.url);
  await page.waitForSelector("#oauthOverlay:not([hidden])", { timeout: 15000 });
  await page.click("#oauthCancel");
  for (let i = 0; i < 50 && !landed; i++) await page.waitForTimeout(200);
  check("cancel returns access_denied", landed && new URL(landed).searchParams.get("error") === "access_denied");

  // the official MCP SDK client, doing its own discovery + registration + PKCE
  landed = null;
  const store = {};
  const provider = {
    get redirectUrl() { return REDIRECT; },
    get clientMetadata() { return { client_name: "SDK Client", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }; },
    clientInformation: () => store.client,
    saveClientInformation: (c) => { store.client = c; },
    tokens: () => store.tokens,
    saveTokens: (t) => { store.tokens = t; },
    saveCodeVerifier: (v) => { store.verifier = v; },
    codeVerifier: () => store.verifier,
    redirectToAuthorization: async (u) => {
      await page.goto(u.toString());
      await page.waitForSelector("#oauthOverlay:not([hidden])", { timeout: 15000 });
      await page.click("#oauthApprove");
      for (let i = 0; i < 50 && !landed; i++) await page.waitForTimeout(200);
    },
  };
  const mk = () => new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider });
  const sdk = new Client({ name: "sdk-oauth", version: "1" });
  try { await sdk.connect(mk()); } catch (e) { if (e?.constructor?.name !== "UnauthorizedError") throw e; }
  const sdkCode = landed && new URL(landed).searchParams.get("code");
  check("SDK client discovered, registered and reached consent", !!sdkCode && store.client?.client_id?.startsWith("vnc_"));
  const t2 = mk();
  await t2.finishAuth(sdkCode);
  const sdk2 = new Client({ name: "sdk-oauth", version: "1" });
  await sdk2.connect(t2);
  const tools = await sdk2.listTools();
  check("SDK client lists the 9 tools with its token", tools.tools.length === 9);
  await sdk2.close();

  // a browser that isn't signed in yet: sign in first, then the same consent appears
  const fresh = await browser.newPage();
  fresh.on("pageerror", (e) => errors.push(String(e)));
  const f = await authorizeUrl(reg.client_id);
  await fresh.goto(f.url);
  await fresh.click("#showCreateBtn");
  await fresh.waitForSelector("#newPhrase:not(:empty)");
  await fresh.check("#savedCheck");
  await fresh.click("#createBtn");
  await fresh.waitForSelector("#oauthOverlay:not([hidden])", { timeout: 15000 });
  check("signing in first still leads to the consent screen", (await fresh.textContent("#oauthApp")) === "Test Chat");

  check("no uncaught page errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  await relay.close();
}
process.exit(failed ? 1 : 0);
