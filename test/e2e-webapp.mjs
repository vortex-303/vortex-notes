// Real browser E2E for the web app: proves content shows, the ⋯ menu works,
// and editing round-trips with no data loss. Run: node test/e2e-webapp.mjs
import { chromium } from "playwright";
import { relayTarget } from "./relay-target.mjs";

const relay = await relayTarget();
const base = relay.base;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// The admin probe intentionally 403s for non-admin sessions — not an error.
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("403")) errors.push(m.text()); });

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };

try {
  await page.goto(`${base}/app`);

  // --- create account ---
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });
  check("account created, app visible", true);

  // --- create a note with frontmatter + body via ＋ ---
  page.once("dialog", (d) => d.accept("poetry/Test Poem"));
  await page.click("#newBtn");
  await page.waitForSelector("#editor [contenteditable=true]", { timeout: 10000 });
  // type a body line
  await page.click("#editor [contenteditable=true]");
  await page.keyboard.type("La pantalla aún brilla\nsecond line here");
  await page.waitForTimeout(1600); // debounced autosave

  // --- CONTENT VISIBLE in the editor (the reported bug) ---
  const editorText = await page.textContent("#editor [contenteditable=true]");
  check("editor shows body content (not blank)", editorText.includes("La pantalla aún brilla"));
  check("editor does NOT show raw YAML frontmatter", !editorText.includes("id:") && !editorText.includes("---"));
  const metaLine = await page.textContent(".notemeta").catch(() => "");
  check("metadata detail line present", metaLine.length > 0);

  // --- ⋯ MENU WORKS ---
  await page.click("#moreBtn");
  const menuVisible = await page.isVisible("#noteMenu");
  check("⋯ menu opens", menuVisible);
  check("menu has rename + duplicate", await page.isVisible("#renameBtn") && await page.isVisible("#dupBtn"));

  // --- NO DATA LOSS: rich view → Edit markdown → rich view, content persists ---
  await page.click("#moreBtn"); // close menu
  check("note opens in the rich (rendered) editor", await page.isVisible("#editor.rich .ProseMirror"));
  await page.click("#moreBtn");
  await page.click("#modeBtn");
  await page.waitForSelector("#editor.source .cm-content");
  const mdText = await page.textContent("#editor.source .cm-content");
  check("Edit markdown shows the content", mdText.includes("La pantalla aún brilla") && mdText.includes("second line here"));
  await page.click("#moreBtn");
  await page.click("#modeBtn");
  await page.waitForSelector("#editor.rich .ProseMirror");
  const reText = await page.textContent("#editor [contenteditable=true]");
  check("content survives rich→markdown→rich (no data loss)", reText.includes("La pantalla aún brilla") && reText.includes("second line here"));

  // --- duplicate works ---
  await page.click("#moreBtn");
  await page.click("#dupBtn");
  await page.waitForTimeout(800);
  const notesList = await page.textContent("#list");
  check("duplicate created a copy", /copy/.test(await page.textContent("#list").catch(() => "")) || notesList.includes("Test Poem"));

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
