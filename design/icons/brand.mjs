// The funnel (B) as every icon the apps and site need. Run: node design/icons/brand.mjs
// Writes: native app icons + in-app logos (ios/App/Shared/Assets.xcassets), web/PWA icons
// (assets/icons), ChatGPT package icons, and src/relay/brand.ts (inline mark, favicon, .ico).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BG = "#121715", INK = "#4CC2A0";

// Six shifting elliptical strokes narrowing to a point (same geometry as make.mjs funnel()).
const ROWS = [[512, 300, 300, 74], [530, 410, 238, 60], [500, 512, 178, 48], [528, 606, 122, 38], [506, 690, 74, 30], [520, 760, 36, 22]];
const glyph = (color, width = 44) =>
  ROWS.map(([cx, cy, rx, ry]) => `<path d="M${cx - rx} ${cy} A${rx} ${ry} 0 0 0 ${cx + rx} ${cy}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`).join("");
const CY = 541; // visual center of the glyph in 1024 space
// Glyph scaled about its center and moved to (512,512).
const placed = (scale, color = INK, width = 44) => `<g transform="translate(512 512) scale(${scale}) translate(-512 -${CY})">${glyph(color, width)}</g>`;
const svg = (inner, box = "0 0 1024 1024") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${inner}</svg>`;

const art = {
  // iOS: full-bleed opaque square; the system applies the rounded mask.
  ios: svg(`<rect width="1024" height="1024" fill="${BG}"/>${placed(1)}`),
  // macOS: Apple's grid, 824px tile with transparent margins.
  mac: svg(`<rect x="100" y="100" width="824" height="824" rx="185" fill="${BG}"/>${placed(0.805)}`),
  // Web "any" icon / listings: the rounded tile edge to edge (as the plugin icon).
  tile: svg(`<rect width="1024" height="1024" rx="228" fill="${BG}"/>${placed(1)}`),
  // PWA maskable: full bleed, glyph inside the 80% safe circle.
  maskable: svg(`<rect width="1024" height="1024" fill="${BG}"/>${placed(0.72)}`),
  // Favicon: heavier strokes so it survives 16px.
  favicon: svg(`<rect width="1024" height="1024" rx="228" fill="${BG}"/>${placed(1, INK, 64)}`),
  // In-app logo (template): glyph only, tight box.
  logo: svg(glyph("#000000"), "180 268 664 548"),
  // Mac menu bar (template): heavier strokes for 18pt.
  menubar: svg(glyph("#000000", 72), "164 252 696 580"),
};

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(svgText, size, file, { opaque = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const src = `data:image/svg+xml;base64,${Buffer.from(svgText).toString("base64")}`;
  await page.setContent(`<body style="margin:0;background:${opaque ? BG : "transparent"}"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`);
  await page.screenshot({ path: file, omitBackground: !opaque });
  if (opaque) {
    // App Store icons must not have an alpha channel: round-trip through JPEG.
    const jpg = file.replace(/\.png$/, ".tmp.jpg");
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "100", file, "--out", jpg], { stdio: "ignore" });
    execFileSync("sips", ["-s", "format", "png", jpg, "--out", file], { stdio: "ignore" });
    fs.rmSync(jpg);
  }
}

// --- native apps ---
const xc = path.join(root, "ios/App/Shared/Assets.xcassets");
if (fs.existsSync(xc)) {
  const icon = path.join(xc, "AppIcon.appiconset");
  for (const f of fs.readdirSync(icon)) if (f.endsWith(".png")) fs.rmSync(path.join(icon, f));
  await png(art.ios, 1024, path.join(icon, "ios-1024.png"), { opaque: true });
  for (const s of [16, 32, 64, 128, 256, 512, 1024]) await png(art.mac, s, path.join(icon, `mac-${s}.png`));
  const mac = (size, scale, file) => ({ filename: file, idiom: "mac", scale, size });
  fs.writeFileSync(path.join(icon, "Contents.json"), JSON.stringify({
    images: [
      { filename: "ios-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" },
      mac("16x16", "1x", "mac-16.png"), mac("16x16", "2x", "mac-32.png"),
      mac("32x32", "1x", "mac-32.png"), mac("32x32", "2x", "mac-64.png"),
      mac("128x128", "1x", "mac-128.png"), mac("128x128", "2x", "mac-256.png"),
      mac("256x256", "1x", "mac-256.png"), mac("256x256", "2x", "mac-512.png"),
      mac("512x512", "1x", "mac-512.png"), mac("512x512", "2x", "mac-1024.png"),
    ],
    info: { author: "xcode", version: 1 },
  }, null, 2) + "\n");
  for (const [name, text] of [["Logo", art.logo], ["MenuBarLogo", art.menubar]]) {
    const dir = path.join(xc, `${name}.imageset`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name.toLowerCase()}.svg`), text);
    fs.writeFileSync(path.join(dir, "Contents.json"), JSON.stringify({
      images: [{ filename: `${name.toLowerCase()}.svg`, idiom: "universal" }],
      info: { author: "xcode", version: 1 },
      properties: { "preserves-vector-representation": true, "template-rendering-intent": "template" },
    }, null, 2) + "\n");
  }
}

// --- web / PWA / ChatGPT ---
const web = path.join(root, "assets/icons");
await png(art.ios, 180, path.join(web, "icon-180.png"), { opaque: true }); // apple-touch: iOS masks it
await png(art.tile, 192, path.join(web, "icon-192.png"));
await png(art.tile, 512, path.join(web, "icon-512.png"));
await png(art.maskable, 512, path.join(web, "icon-maskable-512.png"), { opaque: true });
await png(art.tile, 512, path.join(root, "plugins/chatgpt/assets/logo.png"));
await png(art.tile, 192, path.join(root, "plugins/chatgpt/assets/icon.png"));
fs.copyFileSync(path.join(root, "design/icons/b-funnel-1024.png"), path.join(root, "plugins/vortex-notes/.claude-plugin/icon.png"));

// --- src/relay/brand.ts: inline mark, favicon data URI, /favicon.ico ---
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(path.join(root, "design/icons")), ".ico-"));
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) {
  const f = path.join(tmp, `${s}.png`);
  await png(art.favicon, s, f);
  pngs.push(fs.readFileSync(f));
}
fs.rmSync(tmp, { recursive: true });
// ICO container with embedded PNGs (supported by every current browser).
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
const ico = Buffer.concat([header, ...pngs]);
const markSvg = `<svg viewBox="180 268 664 548" fill="none" xmlns="http://www.w3.org/2000/svg">${glyph("currentColor", 56)}</svg>`;
fs.writeFileSync(path.join(root, "src/relay/brand.ts"), `// Generated by design/icons/brand.mjs. Don't edit by hand; change the script and rerun.
/** The funnel mark, inline (inherits color via currentColor). */
export const MARK = ${JSON.stringify(markSvg)};
/** <link rel="icon"> href: the funnel tile as an SVG data URI. */
export const FAVICON_HREF = ${JSON.stringify("data:image/svg+xml;base64," + Buffer.from(art.favicon).toString("base64"))};
/** /favicon.ico (16/32/48 PNGs in an ICO container), base64. */
export const FAVICON_ICO_B64 = ${JSON.stringify(ico.toString("base64"))};
`);
await browser.close();
console.log("brand assets written; favicon.ico", ico.length, "bytes");
