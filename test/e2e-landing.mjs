// Browser E2E for the landing page: the "Where does your AI live?" picker shows
// one panel per chip, #connect-<client> deep links open the right panel (and the
// right tab on phones), copy buttons strip comments, no horizontal scroll at
// phone width. SHOTS=<dir> also saves 390/1280 × light/dark screenshots.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { relayTarget } from "./relay-target.mjs";

const relay = await relayTarget();
const base = relay.base;
const browser = await chromium.launch();
let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };

try {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/");

  const chips = await page.locator(".chip").evaluateAll((els) => els.map((e) => e.dataset.p));
  check(`picker has 8 chips (${chips.join(", ")})`, chips.length === 8);
  check("Claude panel is the default", await page.isVisible("#connect-claude") && !(await page.isVisible("#connect-chatgpt")));
  for (const id of chips) {
    await page.click(`.chip[data-p="${id}"]`);
    const visible = await page.locator(".cpanel").evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== "none").map((e) => e.id));
    check(`chip ${id} shows only its panel`, visible.length === 1 && visible[0] === `connect-${id}`);
  }
  check("chip click updates the hash", page.url().endsWith("#connect-files"));

  await page.click('.chip[data-p="files"]');
  await page.click("#connect-files .copy");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check("copy strips # comments", clip.includes("vortex-notes setup") && !clip.includes("#"));

  await page.goto(base + "/#connect-hermes");
  check("#connect-hermes deep link opens Hermes", await page.isVisible("#connect-hermes") && !(await page.isVisible("#connect-claude")));
  await page.goto(base + "/#agents");
  check("legacy #agents still lands on Connect", await page.isVisible("#connect"));
  check("no page errors", errors.length === 0);
  if (errors.length) console.log(errors);

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto(base + "/");
  const overflow = async () => phone.evaluate(() => Math.max(...[...document.querySelectorAll("section.door.active, body")].map((e) => e.scrollWidth - e.clientWidth)));
  check("phone: no horizontal scroll on Home", (await overflow()) <= 0);
  await phone.click('.tabbar button[data-t="connect"]');
  check("phone: Connect tab shows the picker", await phone.isVisible(".picker"));
  for (const id of chips) {
    await phone.click(`.chip[data-p="${id}"]`);
    if ((await overflow()) > 0) check(`phone: no horizontal scroll in ${id} panel`, false);
  }
  check("phone: no horizontal scroll in any panel", true);
  await phone.goto(base + "/#connect-chatgpt");
  check("phone: deep link opens Connect tab on ChatGPT", await phone.isVisible("#connect-chatgpt"));
  await phone.click('.tabbar button[data-t="trust"]');
  check("phone: Privacy tab shows the exception", await phone.isVisible(".exception"));

  if (process.env.SHOTS) {
    mkdirSync(process.env.SHOTS, { recursive: true });
    for (const scheme of ["light", "dark"]) {
      const d = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
      await d.goto(base + "/");
      await d.screenshot({ path: `${process.env.SHOTS}/desktop-${scheme}.png`, fullPage: true });
      const m = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme, reducedMotion: "reduce", isMobile: true });
      for (const [tab, hash] of [["home", ""], ["connect", "#connect-claude-code"], ["trust", "#trust"]]) {
        await m.goto(base + "/" + hash);
        await m.screenshot({ path: `${process.env.SHOTS}/phone-${tab}-${scheme}.png` });
      }
    }
    console.log(`screenshots → ${process.env.SHOTS}`);
  }
} finally {
  await browser.close();
  await relay.close();
}
process.exit(failed ? 1 : 0);
