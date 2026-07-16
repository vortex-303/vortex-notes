// Browser E2E for per-note password locks: lock a note, prove it becomes an
// opaque envelope, reload to a fresh session, unlock with the password, and
// confirm the content round-trips with no data loss.
import { chromium } from "playwright";
import { startRelay } from "../dist/relay/server.js";

const relay = await startRelay({ port: 0 });
const base = `http://127.0.0.1:${relay.port}`;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// Note title uses a prompt(); passwords use a masked modal (below).
let nextTitle = "Diary";
page.on("dialog", async (d) => {
  if (/title/i.test(d.message())) await d.accept(nextTitle);
  else await d.accept();
});

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };
const SECRET = "my secret diary content";

try {
  await page.goto(`${base}/app`);

  // create account, capturing the recovery phrase for the reload step
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  const phrase = (await page.textContent("#newPhrase")).trim();
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });

  // new note + type secret body
  await page.click("#newBtn");
  await page.waitForSelector("#cm .cm-content");
  await page.click("#cm .cm-content");
  await page.keyboard.type(SECRET);
  await page.waitForTimeout(1500);

  // lock it: ⋯ → Password-protect → masked modal (password + confirm)
  await page.click("#moreBtn");
  await page.click("#lockBtnItem");
  await page.waitForSelector("#pwInput", { state: "visible" });
  check("lock password input is masked (type=password)", (await page.getAttribute("#pwInput", "type")) === "password");
  await page.fill("#pwInput", "notepw123");
  await page.fill("#pwConfirm", "notepw123");
  await page.click("#pwGo");
  await page.waitForTimeout(1500); // scrypt + save
  check("note shows a lock badge + its real title in the list", (await page.textContent("#list")).includes("Diary") && (await page.locator("#list .listlock").count()) > 0);

  // still unlocked in-session: content readable
  const inSession = await page.textContent("#cm .cm-content").catch(() => "");
  check("stays unlocked in the same session", inSession.includes(SECRET) || inSession.includes("secret"));

  // second note, locked with the SAME password (for the session-wide unlock check)
  nextTitle = "Diary Two";
  await page.click("#newBtn");
  await page.waitForSelector("#cm .cm-content");
  await page.click("#cm .cm-content");
  await page.keyboard.type("second secret note");
  await page.waitForTimeout(1200);
  await page.click("#moreBtn");
  await page.click("#lockBtnItem");
  await page.waitForSelector("#pwInput", { state: "visible" });
  await page.fill("#pwInput", "notepw123");
  await page.fill("#pwConfirm", "notepw123");
  await page.click("#pwGo");
  await page.waitForTimeout(1500);

  // reload → fresh session (session keys gone; account needs the phrase)
  await page.reload();
  await page.waitForSelector("#phrase", { state: "visible" });
  await page.fill("#phrase", phrase);
  await page.click("#unlockBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });

  // open the locked note → password screen, content NOT shown
  await page.getByText("Diary", { exact: true }).click();
  await page.waitForSelector("#unlockPw", { timeout: 8000 });
  check("locked note shows the password screen after reload", await page.isVisible("#unlockPw"));
  check("unlock password input is masked (type=password)", (await page.getAttribute("#unlockPw", "type")) === "password");
  check("title stays visible on the locked note (not hidden)", (await page.textContent("#note")).includes("Diary"));
  const shellText = await page.textContent("#note");
  check("secret is NOT visible before unlocking", !shellText.includes(SECRET));

  // wrong password → error
  await page.fill("#unlockPw", "wrongpass");
  await page.click("#unlockGo");
  await page.waitForTimeout(600);
  check("wrong password is rejected", (await page.textContent("#unlockErr")).toLowerCase().includes("wrong"));

  // right password → content back, no data loss
  await page.fill("#unlockPw", "notepw123");
  await page.click("#unlockGo");
  await page.waitForSelector("#cm .cm-content", { timeout: 8000 });
  const unlocked = await page.textContent("#cm .cm-content");
  check("correct password reveals the exact content (no data loss)", unlocked.includes(SECRET));

  // session-wide: the OTHER same-password note now opens without re-prompting
  await page.getByText("Diary Two", { exact: true }).click();
  await page.waitForTimeout(600);
  const secondOpen = await page.isVisible("#unlockPw").catch(() => false);
  const secondBody = await page.textContent("#cm .cm-content, #note").catch(() => "");
  check("same-password note is unlocked for the session (no re-prompt)", !secondOpen && secondBody.includes("second secret note"));

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
