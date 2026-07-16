// Browser E2E: stay signed in across reloads (no phrase re-prompt), and a real
// sign-out that DOES require the phrase again.
import { chromium } from "playwright";
import { startRelay } from "../dist/relay/server.js";

const relay = await startRelay({ port: 0 });
const base = `http://127.0.0.1:${relay.port}`;
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", async (d) => { if (/title/i.test(d.message())) await d.accept("Nota"); else await d.accept(); });

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };
const atLock = async () => (await page.isVisible("#phrase").catch(() => false)) && !(await page.isVisible("#main").catch(() => false));

try {
  await page.goto(`${base}/app`);
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });

  await page.click("#newBtn");
  await page.waitForSelector("#cm .cm-content");
  await page.click("#cm .cm-content");
  await page.keyboard.type("persistent content");
  await page.waitForTimeout(1500);

  // reload #1 — should auto-unlock, no phrase screen
  await page.reload();
  await page.waitForSelector("#main", { state: "visible", timeout: 12000 }).catch(() => {});
  check("reload auto-unlocks (no phrase screen)", (await page.isVisible("#main")) && !(await atLock()));
  check("notes are present after reload", (await page.textContent("#list")).includes("Nota"));

  // reload #2 — still signed in
  await page.reload();
  await page.waitForSelector("#main", { state: "visible", timeout: 12000 }).catch(() => {});
  check("second reload still signed in", await page.isVisible("#main"));

  // sign out from the user menu (confirm dialog auto-accepted)
  await page.click("#userBtn");
  await page.waitForSelector("#userMenu:not([hidden])");
  await page.click("#lockBtn");
  await page.waitForSelector("#phrase", { state: "visible", timeout: 8000 });
  check("sign out returns to the phrase screen", await atLock());

  // and it stays signed out on the next load (device key cleared)
  await page.reload();
  await page.waitForTimeout(1200);
  check("stays signed out after sign-out (phrase required)", await atLock());

  // --- upgrade path: an old device blob missing accountEnc must self-heal on login ---
  await page.goto(`${base}/app`);
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  const phrase2 = (await page.textContent("#newPhrase")).trim();
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });
  // simulate a pre-upgrade blob: strip accountEnc
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("vn-device"));
    delete d.accountEnc;
    localStorage.setItem("vn-device", JSON.stringify(d));
  });
  await page.reload();
  await page.waitForTimeout(1200);
  check("old blob (no accountEnc) falls back to the phrase screen", await atLock());
  // log in → should upgrade the blob
  await page.fill("#phrase", phrase2);
  await page.click("#unlockBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });
  const healed = await page.evaluate(() => !!JSON.parse(localStorage.getItem("vn-device")).accountEnc);
  check("login upgrades the blob (accountEnc restored)", healed);
  await page.reload();
  await page.waitForTimeout(1200);
  check("after upgrade, reload auto-unlocks", (await page.isVisible("#main")) && !(await atLock()));

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
