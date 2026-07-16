// Browser E2E for public notes: publish via the modal, auto-republish on edit,
// lock-now, and screenshots of all three public themes for visual review.
import { chromium } from "playwright";
import { startRelay } from "../dist/relay/server.js";

const relay = await startRelay({ port: 0 });
const base = `http://127.0.0.1:${relay.port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

let nextTitle = "El Manuscrito";
page.on("dialog", async (d) => {
  if (/title/i.test(d.message())) await d.accept(nextTitle);
  else await d.accept();
});

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };

try {
  await page.goto(`${base}/app`);
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });

  // note with real prose for the themed page
  await page.click("#newBtn");
  await page.waitForSelector("#cm .cm-content");
  await page.click("#cm .cm-content");
  await page.keyboard.type("La pantalla aun brilla, pero la mano ha cambiado — ya no el amo, ya no el esclavo. Una maquina aprende a pensar, y las viejas certezas se derrumban en silencio.");
  await page.waitForTimeout(1500);

  // publish via the modal, signed
  await page.click("#moreBtn");
  await page.click("#pubBtn");
  await page.waitForSelector("#pubModal", { state: "visible" });
  await page.fill("#pubName", "Nico");
  await page.click("#pubGo");
  await page.waitForSelector("#pubLinkRow:not([hidden])", { timeout: 10000 });
  const link = await page.getAttribute("#pubLink", "href");
  check("publish produces a public link", /\/p\/el-manuscrito-/.test(link ?? ""));

  const pub1 = await (await fetch(link)).text();
  check("public page contains the prose + author", pub1.includes("la mano ha cambiado") && pub1.includes("Nico"));

  // auto-republish: edit the note, autosave, public copy updates
  await page.click("#pubClose");
  await page.click("#cm .cm-content");
  await page.keyboard.press("End");
  await page.keyboard.type(" NUEVA LINEA PUBLICA.");
  await page.waitForTimeout(2200); // autosave + republish
  const pub2 = await (await fetch(link)).text();
  check("auto-republish on edit updates the public page", pub2.includes("NUEVA LINEA PUBLICA"));

  // screenshots of each theme
  const slug = link.split("/p/")[1];
  const themes = ["manuscript", "vortex", "typewriter"];
  for (const t of themes) {
    // switch theme via modal
    await page.click("#moreBtn");
    await page.click("#pubBtn");
    await page.waitForSelector("#pubModal", { state: "visible" });
    await page.click(`.themecard.t-${t}`);
    await page.click("#pubGo");
    await page.waitForTimeout(800);
    await page.click("#pubClose").catch(() => undefined);
    const tp = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await tp.goto(`${base}/p/${slug}`);
    await tp.waitForTimeout(400);
    await tp.screenshot({ path: `/tmp/theme-${t}.png`, fullPage: false });
    await tp.close();
    console.log(`  📸 /tmp/theme-${t}.png`);
  }

  // lock-now on a locked note
  nextTitle = "Secreta";
  await page.click("#newBtn");
  await page.waitForSelector("#cm .cm-content");
  await page.click("#cm .cm-content");
  await page.keyboard.type("contenido secreto");
  await page.waitForTimeout(1400);
  await page.click("#moreBtn");
  await page.click("#lockBtnItem");
  await page.waitForSelector("#pwInput", { state: "visible" });
  await page.fill("#pwInput", "pw123");
  await page.fill("#pwConfirm", "pw123");
  await page.click("#pwGo");
  await page.waitForTimeout(1500);
  // note is open+unlocked; menu should offer Lock now
  await page.click("#moreBtn");
  check("menu offers 'Lock now' on an unlocked note", await page.isVisible("#lockNowBtn"));
  await page.click("#lockNowBtn");
  await page.waitForSelector("#unlockPw", { timeout: 8000 });
  check("Lock now hides content immediately (password screen)", !(await page.textContent("#note")).includes("contenido secreto"));

  // locked note's menu must NOT offer publishing
  check("locked notes cannot be published from the menu", !(await page.isVisible("#pubBtn").catch(() => false)));

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
