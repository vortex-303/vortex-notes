// Browser E2E for the bottom-left user menu, agents panel, and flat icons.
import { chromium } from "playwright";
import { startRelay } from "../dist/relay/server.js";

const relay = await startRelay({ port: 0 });
const base = `http://127.0.0.1:${relay.port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", async (d) => { if (/title/i.test(d.message())) await d.accept("Nota"); else await d.accept("Nico"); });

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };

try {
  await page.goto(`${base}/app`);
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });

  // daily-capture box is gone
  check("daily quick-capture removed from sidebar", !(await page.isVisible("#daily").catch(() => false)));
  // user trigger present with an identicon
  check("user menu trigger present bottom-left", await page.isVisible("#userBtn"));
  check("identicon rendered", (await page.locator("#userAvatar svg").count()) > 0);
  // no emoji anywhere in the app shell text
  const bodyText = await page.textContent("body");
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}⭐✨]/u;
  check("no emoji glyphs in the UI text", !emoji.test(bodyText));
  // flat svg icons are used (toolbar + list)
  check("toolbar uses svg icons", (await page.locator(".bar .iconbtn svg").count()) >= 2);

  // open the user menu
  await page.click("#userBtn");
  await page.waitForSelector("#userMenu:not([hidden])");
  check("user menu opens with account/agents/theme items", await page.isVisible("#acctBtn") && await page.isVisible("#agentsBtn") && await page.isVisible("#lockBtn"));
  check("storage row shows a value", /MB|—/.test(await page.textContent("#umStorage")));

  // agents & devices panel lists this device
  await page.click("#agentsBtn");
  await page.waitForSelector("#agentsModal", { state: "visible" });
  await page.waitForTimeout(400);
  const agentsText = await page.textContent("#agentsList");
  check("agents panel lists this device", agentsText.includes("this device"));
  check("this device has no revoke button (can't revoke self)", (await page.locator("#agentsList [data-revoke]").count()) === 0);
  check("agents panel offers pairing", await page.isVisible("#pairBtn"));
  await page.click("#agentsClose");

  // screenshot with the menu open for visual review
  await page.click("#userBtn");
  await page.waitForSelector("#userMenu:not([hidden])");
  await page.screenshot({ path: "/tmp/usermenu.png" });
  console.log("  📸 /tmp/usermenu.png");

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
