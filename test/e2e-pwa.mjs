// Browser E2E: PWA installability + offline launch.
// Verifies the manifest is valid with PNG + maskable icons, the icons and
// service worker are served, the SW registers and controls the page, and the
// app shell loads with the network cut (served from the SW cache).
import { chromium } from "playwright";
import { startRelay } from "../dist/relay/server.js";

const relay = await startRelay({ port: 0 });
const base = `http://127.0.0.1:${relay.port}`;
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };

try {
  // manifest is valid and points at real PNG icons incl. a maskable one
  const manifest = await (await context.request.get(`${base}/app/manifest.webmanifest`)).json();
  check("manifest has standalone display + scoped start_url", manifest.display === "standalone" && manifest.start_url === "/app");
  const pngIcons = manifest.icons.filter((i) => i.type === "image/png");
  check("manifest lists PNG icons (192 + 512)", pngIcons.some((i) => i.sizes === "192x192") && pngIcons.some((i) => i.sizes === "512x512"));
  check("manifest has a maskable icon (Android adaptive)", manifest.icons.some((i) => i.purpose === "maskable"));

  // every referenced icon actually serves as a PNG
  let allPng = true;
  for (const i of manifest.icons) {
    const r = await context.request.get(base + i.src);
    if (r.status() !== 200 || !(r.headers()["content-type"] || "").includes("image/png")) allPng = false;
  }
  const apple = await context.request.get(`${base}/app/icon-180.png`);
  check("all manifest icons + apple-touch-icon serve as PNG", allPng && apple.status() === 200);

  // head wires the apple-touch-icon and manifest
  await page.goto(`${base}/app`);
  check("head links apple-touch-icon", (await page.locator('link[rel="apple-touch-icon"]').count()) === 1);
  check("head links the manifest", (await page.locator('link[rel="manifest"]').count()) === 1);

  // service worker registers and takes control
  const sw = await context.request.get(`${base}/sw.js`);
  check("service worker served with root Service-Worker-Allowed", sw.status() === 200 && sw.headers()["service-worker-allowed"] === "/");
  const controlled = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    // wait until this page is actually controlled
    for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
    return !!navigator.serviceWorker.controller;
  });
  check("service worker controls the page", controlled);

  // OFFLINE: cut the network, reload — the shell must still load from cache
  await page.waitForTimeout(300); // let the shell finish caching
  await context.setOffline(true);
  await page.reload();
  const offlineOk = await page.evaluate(() => !!document.querySelector("#lock, #main"));
  check("app shell loads offline (served from SW cache)", offlineOk);
  const bundleOffline = await page.evaluate(async () => {
    try { const r = await fetch("/app/bundle.js"); return r.ok; } catch { return false; }
  });
  check("bundle available offline", bundleOffline);
  await context.setOffline(false);

  // API calls are NEVER cached by the SW (must pass through to the network)
  await context.setOffline(true);
  const apiBlocked = await page.evaluate(async () => {
    try { await fetch("/v1/usage"); return "reached"; } catch { return "network-error"; }
  });
  check("SW does not serve /v1/* from cache (stays network-only)", apiBlocked === "network-error");
  await context.setOffline(false);

  check("no failures", !failed);
} catch (e) {
  console.log("✗ EXCEPTION:", e.message);
  failed = true;
} finally {
  await browser.close();
  await relay.close();
}
process.exit(failed ? 1 : 0);
