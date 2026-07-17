// Browser E2E: admin accounts panel — visibility, per-account rows, tagging.
// Creates an account against a relay with no admin, then restarts the relay on
// the same port/db with THAT account as admin, so the same browser session
// becomes the admin.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRelay } from "../dist/relay/server.js";

const dbPath = join(mkdtempSync(join(tmpdir(), "vn-admin-")), "relay.db");
let relay = await startRelay({ port: 0, dbPath });
const port = relay.port;
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", async (d) => { await d.accept("Nota"); });

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };

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
  await page.keyboard.type("hello admin");
  await page.waitForTimeout(1500);

  await page.click("#userBtn");
  await page.waitForSelector("#userMenu:not([hidden])");
  check("admin item hidden while not admin", !(await page.isVisible("#adminBtn")));
  await page.keyboard.press("Escape");

  const account = await page.evaluate(() => JSON.parse(localStorage.getItem("vn-device")).account);

  // restart the relay with this account as admin (same port, same db)
  await relay.close();
  relay = await startRelay({ port, dbPath, adminAccount: account });

  await page.reload();
  await page.waitForSelector("#main", { state: "visible", timeout: 12000 });
  await page.click("#userBtn");
  await page.waitForSelector("#userMenu:not([hidden])");
  await page.waitForSelector("#adminBtn:not([hidden])", { timeout: 8000 });
  check("admin item appears for the admin account", await page.isVisible("#adminBtn"));

  await page.click("#adminBtn");
  await page.waitForSelector(".adrow", { timeout: 8000 });
  check("stats cards render", (await page.locator("#adminGrid .statcard").count()) >= 8);
  const newCard = () => page.locator("#adminGrid .statcard", { hasText: "new · untagged" }).locator("b").textContent();
  check("one untagged account", (await newCard()) === "1");
  const row = await page.textContent(".adrow");
  check("row shows a readable device name", /Chrome|Safari|Firefox|browser/.test(row));
  check("row shows a non-zero update count", /[1-9]\d* upd/.test(row));
  check("row is marked new", (await page.locator(".adrow .tagchip.new").count()) === 1);

  await page.click('.adrow [data-tag="mine"]');
  await page.waitForFunction(() => document.querySelector(".adrow .tagchip")?.textContent === "mine");
  check("tagging as mine updates the chip", true);
  check("untagged count drops to zero", (await newCard()) === "0");

  await page.click('.adrow [data-tag=""]');
  await page.waitForFunction(() => document.querySelector(".adrow .tagchip.new") !== null);
  check("clearing the tag marks it new again", (await newCard()) === "1");

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
