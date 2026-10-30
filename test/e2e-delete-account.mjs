// Browser E2E: Account & recovery → Delete my account. The button waits for "delete" to be
// typed; afterwards this browser is signed out, and signing back in with the same 12 words
// finds nothing: no space, no notes are left on the server.
import { chromium } from "playwright";
import { relayTarget } from "./relay-target.mjs";

const relay = await relayTarget();
const base = relay.base;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept("Doomed"));
let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };

try {
  await page.goto(`${base}/app`);
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  const phrase = (await page.textContent("#newPhrase")).trim();
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });
  await page.click("#newBtn");
  await page.waitForSelector("#editor [contenteditable=true]", { timeout: 10000 });
  await page.click("#editor [contenteditable=true]");
  await page.keyboard.type("This note must not survive.");
  await page.waitForTimeout(2200);
  check("note exists before deletion", (await page.locator('[data-path="doomed.md"]').count()) === 1);

  await page.click("#userBtn");
  await page.click("#acctBtn");
  await page.waitForSelector("#delAcctBtn", { state: "visible" });
  check("delete button waits for the word", await page.isDisabled("#delAcctBtn"));
  await page.fill("#delAcctConfirm", "delete");
  check("typing delete enables it", !(await page.isDisabled("#delAcctBtn")));
  await page.click("#delAcctBtn");
  await page.waitForSelector("#phrase", { state: "visible", timeout: 15000 });
  check("after deletion this browser is signed out", await page.isVisible("#phrase"));

  // Same 12 words: nothing is left to open.
  await page.fill("#phrase", phrase);
  await page.click("#unlockBtn");
  await page.waitForFunction(() => /No spaces for this account/.test(document.querySelector("#status")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
  check("signing back in with the old words finds nothing", /No spaces for this account/.test(await page.textContent("#status")));
  check("and no notes appear", !(await page.isVisible("#main")));
  check("no uncaught page errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  await relay.close();
}
process.exit(failed ? 1 : 0);
