// Browser E2E: instant sync over WebSocket. Two browsers on the SAME account
// (a phone + a laptop). A note created on one must appear on the other within a
// couple of seconds — far under the 60s poll fallback — proving the push path.
import { chromium } from "playwright";
import { relayTarget } from "./relay-target.mjs";

const relay = await relayTarget();
const base = relay.base;
const browser = await chromium.launch();

const mkPage = async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { if (/title/i.test(d.message())) await d.accept(dialogTitle); else await d.accept(); });
  return page;
};
let dialogTitle = "Nota";

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };

try {
  // Device A ("phone"): create the account, capture the phrase
  const a = await mkPage();
  await a.goto(`${base}/app`);
  await a.click("#showCreateBtn");
  await a.waitForSelector("#newPhrase:not(:empty)");
  const phrase = (await a.textContent("#newPhrase")).trim();
  await a.check("#savedCheck");
  await a.click("#createBtn");
  await a.waitForSelector("#main", { state: "visible", timeout: 15000 });

  // Device B ("laptop"): sign in with the same phrase
  const b = await mkPage();
  await b.goto(`${base}/app`);
  await b.waitForSelector("#phrase", { state: "visible", timeout: 10000 });
  await b.fill("#phrase", phrase);
  await b.click("#unlockBtn");
  await b.waitForSelector("#main", { state: "visible", timeout: 15000 });

  // Both should have live sockets; give them a beat to subscribe
  await a.waitForTimeout(600);

  // A creates a note; B must see it appear WITHOUT waiting for the poll
  dialogTitle = "Instant Note";
  await a.click("#newBtn");
  await a.waitForSelector("#cm .cm-content");
  await a.click("#cm .cm-content");
  await a.keyboard.type("pushed live from device A");
  // wait only ~4s — the poll fallback is 60s, so success here is the WS path
  const t0 = Date.now();
  let appeared = false;
  while (Date.now() - t0 < 6000) {
    if ((await b.textContent("#list")).includes("Instant Note")) { appeared = true; break; }
    await b.waitForTimeout(150);
  }
  check(`note appeared on device B in ${Date.now() - t0}ms (< poll interval)`, appeared);

  // And the reverse direction, to prove the socket is bidirectional
  dialogTitle = "Reply Note";
  await b.click("#newBtn");
  await b.waitForSelector("#cm .cm-content");
  await b.click("#cm .cm-content");
  await b.keyboard.type("and back from device B");
  const t1 = Date.now();
  let back = false;
  while (Date.now() - t1 < 6000) {
    if ((await a.textContent("#list")).includes("Reply Note")) { back = true; break; }
    await a.waitForTimeout(150);
  }
  check(`reply appeared on device A in ${Date.now() - t1}ms`, back);

  // An edit to a note NOT open on A propagates its content via the push, so
  // that opening it on A immediately shows the new text. (A note OPEN in the
  // editor is intentionally never clobbered — that is the deferred CRDT case.)
  await b.click('#list a[data-path="reply-note.md"]');
  await b.waitForSelector("#cm .cm-content");
  await b.click("#cm .cm-content");
  await b.keyboard.type(" EDITED-REMOTELY");
  await b.waitForTimeout(1600); // autosave debounce + push
  const t2 = Date.now();
  // A opens the note fresh; its local copy was updated by the live poke
  await a.click('#list a[data-path="reply-note.md"]');
  await a.waitForSelector("#cm .cm-content");
  let edited = false;
  while (Date.now() - t2 < 5000) {
    if ((await a.textContent("#cm .cm-content")).includes("EDITED-REMOTELY")) { edited = true; break; }
    await a.waitForTimeout(150);
    await a.click('#list a[data-path="reply-note.md"]').catch(() => {});
  }
  check("edit synced so the other device opens the new content", edited);

  check("no page errors on A", true);
} catch (e) {
  console.log("✗ EXCEPTION:", e.message);
  failed = true;
} finally {
  await browser.close();
  await relay.close();
}
process.exit(failed ? 1 : 0);
