// Rasterize the Vortex mark into PWA PNG icons. Run: node scripts/gen-icons.mjs
// (uses the Playwright chromium already installed for e2e). Output → assets/icons/.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../assets/icons");
mkdirSync(outDir, { recursive: true });

const BG = "#121715";
const ACCENT = "#4CC2A0";

// The tri-arc vortex, drawn to fill a 24-box; `scale` shrinks it for maskable padding.
const mark = (scale) => `
  <g transform="translate(12 12) scale(${scale}) translate(-12 -12)">
    <g stroke="${ACCENT}" stroke-width="2" stroke-linecap="round" fill="none">
      <path d="M12 3.5 A8.5 8.5 0 0 1 20.5 12"/>
      <path d="M12 3.5 A8.5 8.5 0 0 1 20.5 12" transform="rotate(120 12 12)"/>
      <path d="M12 3.5 A8.5 8.5 0 0 1 20.5 12" transform="rotate(240 12 12)"/>
    </g>
    <circle cx="12" cy="12" r="1.8" fill="${ACCENT}"/>
  </g>`;

// rounded = app-icon squircle-ish corners; maskable = full-bleed bg + padded mark.
const svg = ({ rounded, maskable }) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512">
    <rect width="24" height="24" rx="${maskable ? 0 : rounded}" fill="${BG}"/>
    ${mark(maskable ? 0.62 : 0.82)}
  </svg>`;

const jobs = [
  { name: "icon-192.png", size: 192, opts: { rounded: 5 } },
  { name: "icon-512.png", size: 512, opts: { rounded: 5 } },
  { name: "icon-maskable-512.png", size: 512, opts: { rounded: 0, maskable: true } },
  { name: "icon-180.png", size: 180, opts: { rounded: 4 } }, // apple-touch-icon
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { name, size, opts } of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>*{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg(opts)}`
  );
  await page.locator("svg").screenshot({ path: join(outDir, name), omitBackground: false });
  console.log("wrote", name, `${size}×${size}`);
}
await browser.close();
