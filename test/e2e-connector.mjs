// Browser E2E: "Connect a chat app" creates a hosted MCP connector URL that a
// remote client (claude.ai / ChatGPT stand-in) can use to read and write notes,
// and the note it writes shows up in the web app. Revoke kills the URL.
import { chromium } from "playwright";
import { relayTarget } from "./relay-target.mjs";

const relay = await relayTarget();
const base = relay.base;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", async (d) => { if (/title/i.test(d.message())) await d.accept("Kiln plan"); else await d.accept(); });

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };
let rpcId = 0;
const rpc = async (url, method, params = {}) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

try {
  await page.goto(`${base}/app`);
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });

  // a note for the chat app to find
  await page.click("#newBtn");
  await page.waitForSelector("#editor [contenteditable=true]", { timeout: 10000 });
  await page.click("#editor [contenteditable=true]");
  await page.keyboard.type("Cone 6 firing, slow cool overnight.");
  await page.waitForTimeout(2500); // autosave + push

  await page.click("#userBtn");
  await page.click("#agentsBtn");
  await page.waitForSelector("#agentsModal", { state: "visible" });
  await page.click("#chatBtn");
  await page.waitForSelector("#chatModal", { state: "visible" });
  check("connector dialog warns that the relay holds this key", /relay holds this agent's key/i.test(await page.textContent("#chatStep1")));
  await page.fill("#chatName", "Claude.ai");
  await page.click("#chatCreate");
  await page.waitForSelector("#chatStep2:not([hidden])", { timeout: 15000 });
  const url = (await page.textContent("#chatUrl")).trim();
  check("connector URL shown", /\/mcp\/[0-9a-f]{64}$/.test(url));

  const init = await rpc(url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  check("remote client initializes", init.body?.result?.serverInfo?.name === "vortex-notes");
  const found = await rpc(url, "tools/call", { name: "search_notes", arguments: { query: "cone firing" } });
  check("remote client finds the browser's note", /Cone 6 firing/.test(found.body?.result?.content?.[0]?.text ?? ""));
  const wrote = await rpc(url, "tools/call", { name: "write_note", arguments: { title: "From chat", content: "Written by the chat app." } });
  check("remote client writes a note", /Created from-chat\.md/.test(wrote.body?.result?.content?.[0]?.text ?? ""));

  // the chat app's note appears in the web app (live sync poke or refresh)
  await page.click("#chatClose");
  await page.click("#agentsClose");
  await page.waitForFunction(() => /From chat/.test(document.querySelector("#list")?.textContent ?? ""), null, { timeout: 15000 }).catch(() => {});
  if (!/From chat/.test((await page.textContent("#list")) ?? "")) { await page.reload(); await page.waitForSelector("#main", { state: "visible" }); }
  check("chat app's note shows up in the web app", /From chat/.test((await page.textContent("#list")) ?? ""));

  // agents panel lists it as a chat connector with Copy URL; revoke kills the URL
  await page.click("#userBtn");
  await page.click("#agentsBtn");
  await page.waitForSelector("[data-copyurl]", { timeout: 10000 });
  check("agents panel marks it as a chat connector", /chat connector/.test(await page.textContent("#agentsList")));
  await page.click('[data-revoke][data-name="Claude.ai"]');
  await page.waitForFunction(() => !document.querySelector("[data-copyurl]"), null, { timeout: 10000 });
  check("revoked connector URL is dead", (await rpc(url, "tools/list")).status === 404);
  check("no uncaught page errors", errors.length === 0);
  if (errors.length) console.log(errors);
} catch (e) {
  console.log("✗ crashed:", e);
  failed = true;
} finally {
  await browser.close();
  await relay.close();
}
process.exit(failed ? 1 : 0);
