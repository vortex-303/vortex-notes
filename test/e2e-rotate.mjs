// Browser E2E: account rotation ("change my 12 words").
// Journey: create account → notes (one password-locked) → rotate → everything
// still works → reload auto-unlocks → OLD phrase is dead → NEW phrase signs in
// and the NEW words unlock the locked note.
import { chromium } from "playwright";
import { startRelay } from "../dist/relay/server.js";

const relay = await startRelay({ port: 0 });
const base = `http://127.0.0.1:${relay.port}`;
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors = [];
let sawDoneAlert = false;
page.on("pageerror", (e) => errors.push(String(e)));
let nextTitle = "Nota";
page.on("dialog", async (d) => {
  if (/only to the new 12 words/i.test(d.message())) sawDoneAlert = true;
  if (/title/i.test(d.message())) await d.accept(nextTitle);
  else await d.accept();
});

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };

try {
  await page.goto(`${base}/app`);
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  const oldPhrase = (await page.textContent("#newPhrase")).trim();
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });

  // a plain note
  nextTitle = "Plain";
  await page.click("#newBtn");
  await page.waitForSelector("#cm .cm-content");
  await page.click("#cm .cm-content");
  await page.keyboard.type("plain survives rotation");
  await page.waitForTimeout(1600);

  // a locked note (v2), left unlocked in this session
  nextTitle = "Vaulted";
  await page.click("#newBtn");
  await page.waitForSelector("#cm .cm-content");
  await page.click("#cm .cm-content");
  await page.keyboard.type("vaulted secret");
  await page.waitForTimeout(1600);
  await page.click("#moreBtn");
  await page.click("#lockBtnItem");
  await page.waitForSelector("#pwInput", { state: "visible" });
  await page.fill("#pwInput", "pw-stays");
  await page.fill("#pwConfirm", "pw-stays");
  await page.click("#pwGo");
  await page.waitForTimeout(1500);

  // rotate
  await page.click("#userBtn");
  await page.waitForSelector("#userMenu:not([hidden])");
  await page.click("#acctBtn");
  await page.waitForSelector("#rotBtn");
  await page.click("#rotBtn");
  await page.waitForSelector("#rotPhrase:not(:empty)");
  const newPhrase = (await page.textContent("#rotPhrase")).trim();
  check("a fresh 12-word phrase is shown", newPhrase.split(" ").length === 12 && newPhrase !== oldPhrase);
  check("re-key button is disabled until saved is confirmed", await page.isDisabled("#rotGo"));
  await page.check("#rotSaved");
  await page.click("#rotGo");
  await page.waitForFunction(() => document.querySelector("#rotFlow").hidden, null, { timeout: 20000 });
  check("rotation completes with the summary alert", sawDoneAlert);
  await page.click("#acctClose");

  // same session still works
  check("notes list intact after rotation", (await page.textContent("#list")).includes("Plain"));

  // reload: the new device blob auto-unlocks
  await page.reload();
  await page.waitForSelector("#main", { state: "visible", timeout: 12000 });
  check("reload auto-unlocks under the new account", await page.isVisible("#main"));
  check("notes intact after reload", (await page.textContent("#list")).includes("Vaulted"));

  // sign out; OLD phrase must be dead
  await page.click("#userBtn");
  await page.waitForSelector("#userMenu:not([hidden])");
  await page.click("#lockBtn");
  await page.waitForSelector("#phrase", { state: "visible", timeout: 8000 });
  await page.fill("#phrase", oldPhrase);
  await page.click("#unlockBtn");
  await page.waitForTimeout(2500);
  const lockText = await page.textContent("#lock");
  check("old phrase no longer reaches the notes", !(await page.isVisible("#main")) && /no spaces/i.test(lockText));

  // NEW phrase signs in and sees everything
  await page.fill("#phrase", newPhrase);
  await page.click("#unlockBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });
  check("new phrase signs in", await page.isVisible("#main"));
  check("all notes present under the new phrase", (await page.textContent("#list")).includes("Plain") && (await page.textContent("#list")).includes("Vaulted"));

  // the locked note opens with the NEW 12 words (it was re-sealed)
  await page.getByText("Vaulted", { exact: true }).click();
  await page.waitForSelector("#unlockPw", { timeout: 8000 });
  await page.click("#phraseToggle");
  await page.fill("#unlockPhrase", newPhrase);
  await page.click("#phraseGo");
  await page.waitForSelector("#cm .cm-content", { timeout: 8000 });
  check("NEW words unlock the locked note", (await page.textContent("#cm .cm-content")).includes("vaulted secret"));

  check("no uncaught page errors", errors.length === 0);
  if (errors.length) console.log("  errors:", errors.slice(0, 3));
} catch (e) {
  console.log("✗ EXCEPTION:", e.message);
  console.log("  page errors:", errors.slice(0, 3));
  failed = true;
} finally {
  await browser.close();
  await relay.close();
}
process.exit(failed ? 1 : 0);
