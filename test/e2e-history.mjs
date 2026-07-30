// Browser E2E: version history + lost-password recovery.
// A note is written, then locked; the password is "lost" (session cleared by
// reload). The lock screen's recovery link must open history, show the
// pre-lock version as readable, and restore it without any password.
import { chromium } from "playwright";
import { startRelay } from "../dist/relay/server.js";

const relay = await startRelay({ port: 0 });
const base = `http://127.0.0.1:${relay.port}`;
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", async (d) => {
  if (/title/i.test(d.message())) await d.accept("Diary");
  else await d.accept(); // restore confirm
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

  // write the note (this version must be recoverable later)
  await page.click("#newBtn");
  await page.waitForSelector("#cm .cm-content");
  await page.click("#cm .cm-content");
  await page.keyboard.type("the secret recipe is honey");
  await page.waitForTimeout(1800); // autosave push

  // lock it
  await page.click("#moreBtn");
  await page.click("#lockBtnItem");
  await page.waitForSelector("#pwInput", { state: "visible" });
  await page.fill("#pwInput", "forgotten-pw");
  await page.fill("#pwConfirm", "forgotten-pw");
  await page.click("#pwGo");
  await page.waitForTimeout(1500); // scrypt + save
  check("note locked (badge in list)", (await page.locator("#list .listlock").count()) > 0);

  // "lose" the password: reload clears session keys, then open the note
  await page.reload();
  await page.waitForSelector("#main", { state: "visible", timeout: 12000 });
  await page.click("#list a[data-path]");
  await page.waitForSelector("#unlockPw", { state: "visible" });
  check("lock screen offers recovery link", await page.isVisible("#lostPwBtn"));

  // recover from history
  await page.click("#lostPwBtn");
  await page.waitForSelector(".histrow", { timeout: 10000 });
  const rows = await page.locator(".histrow").count();
  check("history lists multiple versions", rows >= 2);
  check("latest version is marked locked", (await page.textContent(".histrow")).includes("locked"));
  check("a pre-lock version is readable", (await page.locator(".histrow .tagchip.open").count()) >= 1);

  // locked version refuses restore
  await page.click(".histrow");
  check("locked version cannot be restored", !(await page.isVisible("#histRestore")));

  // readable version previews and restores
  await page.locator(".histrow:has(.tagchip.open)").first().click();
  await page.waitForSelector(".histarticle");
  check("preview shows the lost content", (await page.textContent(".histarticle")).includes("secret recipe"));
  await page.click("#histRestore");
  await page.waitForSelector("#cm .cm-content", { timeout: 10000 });
  check("restored note opens unlocked", (await page.textContent("#cm .cm-content")).includes("honey"));
  check("lock badge is gone from the list", (await page.locator("#list .listlock").count()) === 0);

  // history also reachable from the note menu
  await page.click("#moreBtn");
  await page.click("#histBtn");
  await page.waitForSelector(".histrow");
  check("menu → History shows the locked version still in history", (await page.textContent("#histList")).includes("locked"));
  await page.click("#histClose");

  // download the note as .md — must be the readable content, right filename
  await page.click("#moreBtn");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#dlMdBtn"),
  ]);
  check("download has a .md filename from the title", /Diary\.md$/.test(download.suggestedFilename()));
  const dlPath = await download.path();
  const dlContent = (await import("node:fs")).readFileSync(dlPath, "utf8");
  check("downloaded file contains the note content", dlContent.includes("honey"));
  check("downloaded file is NOT an encrypted envelope", !dlContent.includes("vortex-locked:"));

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
