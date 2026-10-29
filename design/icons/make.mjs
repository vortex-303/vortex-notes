// Icon options for the Vortex Notes listing / app. Run: node design/icons/make.mjs
// Writes <id>.svg, <id>-1024.png, <id>-512.png and sheet.png (needs playwright).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dir = path.dirname(fileURLToPath(import.meta.url));
const BG = "#121715", INK = "#4CC2A0", SOFT = "#2E7F69", PAPER = "#F8FAF8", DEEP = "#14735C";
const tile = (fill, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="228" fill="${fill}"/>${inner}</svg>`;
const f = (n) => n.toFixed(1);

// B · Funnel: a tornado drawn as stacked, shifting elliptical strokes narrowing to a point.
function funnel() {
  const rows = [[512, 300, 300, 74], [530, 410, 238, 60], [500, 512, 178, 48], [528, 606, 122, 38], [506, 690, 74, 30], [520, 760, 36, 22]];
  const arcs = rows.map(([cx, cy, rx, ry]) =>
    `<path d="M${f(cx - rx)} ${cy} A${rx} ${ry} 0 0 0 ${f(cx + rx)} ${cy}" stroke="${INK}" stroke-width="44" stroke-linecap="round" fill="none"/>`).join("");
  return tile(BG, arcs);
}

// C · Spiral: one continuous stroke winding out from a center dot.
function spiral() {
  const pts = [];
  for (let t = 0.9; t <= 2.6 * Math.PI * 2; t += 0.05) {
    const r = 26 + 22 * t;
    pts.push([512 + r * Math.cos(t - 1.2), 512 + r * Math.sin(t - 1.2)]);
  }
  const d = "M" + pts.map((p) => p.map(f).join(" ")).join(" L");
  return tile(BG, `<path d="${d}" stroke="${INK}" stroke-width="52" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="512" cy="512" r="40" fill="${INK}"/>`);
}

// D · Galaxy: the current three arcs, curved into blades that pull toward the center.
function galaxy() {
  const blade = (rot) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40, a = (rot + u * 150) * Math.PI / 180, r = 110 + u * 250;
      pts.push([512 + r * Math.cos(a), 512 + r * Math.sin(a)]);
    }
    return `<path d="M${pts.map((p) => p.map(f).join(" ")).join(" L")}" stroke="${INK}" stroke-width="64" stroke-linecap="round" fill="none"/>`;
  };
  return tile(BG, blade(-90) + blade(30) + blade(150) + `<circle cx="512" cy="512" r="58" fill="${INK}"/>`);
}

// E · Note + vortex: a page with a folded corner, the spiral on it. Light tile.
function note() {
  const pts = [];
  for (let t = 0.6; t <= 2.15 * Math.PI * 2; t += 0.05) {
    const r = 14 + 13 * t;
    pts.push([500 + r * Math.cos(t - 1.2), 540 + r * Math.sin(t - 1.2)]);
  }
  const d = "M" + pts.map((p) => p.map(f).join(" ")).join(" L");
  return tile(PAPER,
    `<path d="M262 196 H662 L786 320 V788 a40 40 0 0 1 -40 40 H262 a40 40 0 0 1 -40 -40 V236 a40 40 0 0 1 40 -40 Z" fill="#FFFFFF" stroke="#DFE6E1" stroke-width="12"/>` +
    `<path d="M662 196 V292 a28 28 0 0 0 28 28 H786" fill="#E3F0EB" stroke="#DFE6E1" stroke-width="12" stroke-linejoin="round"/>` +
    `<path d="${d}" stroke="${DEEP}" stroke-width="38" stroke-linecap="round" fill="none"/><circle cx="500" cy="540" r="26" fill="${DEEP}"/>`);
}

// F · Rings, light: option A's mark on the light ground, for comparison.
function ringsLight() {
  const arc = (r, w, op) => [0, 120, 240].map((rot) =>
    `<path d="M512 ${512 - r} A${r} ${r} 0 0 1 ${512 + r} 512" transform="rotate(${rot} 512 512)" stroke="${DEEP}" stroke-width="${w}" stroke-linecap="round" fill="none" opacity="${op}"/>`).join("");
  return tile(PAPER, arc(320, 64, 1) + arc(180, 56, 0.5) + `<circle cx="512" cy="512" r="56" fill="${DEEP}"/>`);
}

const options = [
  ["a-rings", "A · Rings (current app icon)", null],
  ["b-funnel", "B · Funnel", funnel()],
  ["c-spiral", "C · Spiral", spiral()],
  ["d-galaxy", "D · Galaxy", galaxy()],
  ["e-note", "E · Note + vortex", note()],
  ["f-rings-light", "F · Rings, light", ringsLight()],
];

// A is the existing raster icon, used as-is.
const appIcon = path.resolve(dir, "../../ios/App/Shared/Assets.xcassets/AppIcon.appiconset/icon-1024.png");
const fallback = path.resolve(dir, "../../assets/icons/icon-512.png");
const aSrc = fs.existsSync(appIcon) ? appIcon : fallback;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
for (const [id, , svg] of options) {
  let src;
  if (svg) {
    fs.writeFileSync(path.join(dir, `${id}.svg`), svg);
    src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  } else src = `data:image/png;base64,${fs.readFileSync(aSrc).toString("base64")}`;
  for (const size of [1024, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`);
    await page.screenshot({ path: path.join(dir, `${id}-${size}.png`), omitBackground: true });
  }
}
// Contact sheet: each option big, plus small sizes as they'd appear in a list.
const cells = options.map(([id, label]) => {
  const b64 = fs.readFileSync(path.join(dir, `${id}-512.png`)).toString("base64");
  return `<figure><img src="data:image/png;base64,${b64}" width="220"><div class="sm"><img src="data:image/png;base64,${b64}" width="64"><img src="data:image/png;base64,${b64}" width="32"></div><figcaption>${label}</figcaption></figure>`;
}).join("");
await page.setViewportSize({ width: 1200, height: 760 });
await page.setContent(`<body style="margin:0;background:#E9EEEA;font:600 18px -apple-system,sans-serif;color:#1D2421">
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:28px;padding:36px">${cells}</div>
<style>figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px}.sm{display:flex;gap:12px;align-items:center}</style></body>`);
await page.screenshot({ path: path.join(dir, "sheet.png"), fullPage: true });
await browser.close();
console.log("wrote", options.map(([id]) => id).join(", "), "+ sheet.png");
