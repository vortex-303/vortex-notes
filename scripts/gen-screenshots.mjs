// Capture real app screenshots for the README. Run: node scripts/gen-screenshots.mjs
// Spins up a local relay, seeds a few realistic notes, shoots desktop + mobile
// + the agents panel + the landing hero. Output → docs/media/.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startRelay } from "../dist/relay/server.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "../docs/media");
mkdirSync(out, { recursive: true });

const relay = await startRelay({ port: 0 });
const base = `http://127.0.0.1:${relay.port}`;
const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });

// Prose-forward content: the live editor auto-continues list markers, so
// multi-item lists double when typed. Headings/bold/quotes/wikilinks render
// cleanly and showcase the live-preview editor without artifacts.
const NOTES = [
  {
    title: "Project Vortex — roadmap",
    body: `# Project Vortex — roadmap

Shared memory for **me and my agents** — one encrypted place, shipping weekly.

## Shipped this week

Instant cross-device sync over WebSocket, an installable app that works
offline, and per-note password locks you can open with your **12 words**.

Next up: push to my phone the moment an agent writes a note.

See also [[Launch checklist]] and [[Architecture notes]].

> Files are the truth — every note is plain markdown the agents can read.`,
  },
  {
    title: "Launch checklist",
    body: `# Launch checklist

The public repo and npm package are live, and the MCP directories are in
review. **Show HN** goes out Tuesday at 14:00 UTC.

My agent reads this note and updates it as each item lands.`,
  },
  {
    title: "Meeting — pricing",
    body: `# Meeting — pricing

Self-hosting stays free. Hosted **Pro** at ~$4/mo for more storage, plus a
one-time **lifetime** tier for the privacy crowd.

Billing through a merchant of record so global tax is handled for me.`,
  },
  {
    title: "Reading list",
    body: `# Reading list

Notes on end-to-end encryption design, CRDTs versus three-way merge, and
the certificate chain that lets an agent hold its own scoped key.`,
  },
];

async function newAccountPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  let title = "Nota";
  page.on("dialog", async (d) => { if (/title/i.test(d.message())) await d.accept(title); else await d.accept(); });
  page.setTitleForDialog = (t) => (title = t);
  await page.goto(`${base}/app`);
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });
  return page;
}

async function seed(page) {
  for (const n of NOTES) {
    page.setTitleForDialog(n.title);
    await page.click("#newBtn");
    await page.waitForSelector("#editor [contenteditable=true]");
    await page.click("#editor [contenteditable=true]");
    await page.keyboard.type(n.body);
    await page.waitForTimeout(900);
  }
  // leave the roadmap note open in the live editor
  await page.click('#list a[data-path="project-vortex-roadmap.md"]').catch(() => {});
  await page.waitForTimeout(500);
}

// 1) desktop app — sidebar + live-preview editor
const desk = await newAccountPage();
await seed(desk);
await desk.screenshot({ path: join(out, "app-desktop.png") });
console.log("wrote app-desktop.png");

// 2) agents & devices panel — the agent-native story
await desk.click("#userBtn");
await desk.waitForSelector("#userMenu:not([hidden])");
await desk.click("#agentsBtn");
await desk.waitForSelector("#agentsModal", { state: "visible" });
await desk.waitForTimeout(400);
await desk.screenshot({ path: join(out, "app-agents.png") });
console.log("wrote app-agents.png");
await desk.context().close();

// 3) mobile — the single-page phone experience
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
const m = await mctx.newPage();
let mtitle = "Nota";
m.on("dialog", async (d) => { if (/title/i.test(d.message())) await d.accept(mtitle); else await d.accept(); });
await m.goto(`${base}/app`);
await m.click("#showCreateBtn");
await m.waitForSelector("#newPhrase:not(:empty)");
await m.check("#savedCheck");
await m.click("#createBtn");
await m.waitForSelector("#main", { state: "visible", timeout: 15000 });
for (const n of NOTES) {
  mtitle = n.title;
  await m.click("#newBtn");
  await m.waitForSelector("#editor [contenteditable=true]");
  await m.click("#editor [contenteditable=true]");
  await m.keyboard.type(n.body);
  await m.waitForTimeout(700);
  await m.click("#backBtn").catch(() => {});
  await m.waitForTimeout(200);
}
// open a note so the shot shows the mobile reading/editing surface
await m.click('#list a[data-path="project-vortex-roadmap.md"]').catch(() => {});
await m.waitForTimeout(600);
await m.screenshot({ path: join(out, "app-mobile.png") });
console.log("wrote app-mobile.png");
await mctx.close();

// 4) landing hero
const lctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const l = await lctx.newPage();
await l.goto(base);
await l.waitForTimeout(800);
await l.screenshot({ path: join(out, "landing.png") });
console.log("wrote landing.png");
await lctx.close();

await browser.close();
await relay.close();
