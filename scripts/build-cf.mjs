// Build the Cloudflare Pages output (dist-cf/public): static app assets + the
// tiny _worker.js front door. Run after `npm run build` (needs dist/webapp).
// The Durable Object Worker itself is bundled by wrangler from deploy/cf/worker.ts.
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const out = "dist-cf/public";
fs.rmSync("dist-cf", { recursive: true, force: true });
fs.mkdirSync(path.join(out, "app"), { recursive: true });

fs.copyFileSync("dist/webapp/bundle.js", path.join(out, "app/bundle.js"));
fs.copyFileSync("assets/demo.svg", path.join(out, "demo.svg"));
for (const f of fs.readdirSync("assets/icons")) {
  if (f.endsWith(".png")) fs.copyFileSync(path.join("assets/icons", f), path.join(out, "app", f));
}

// Direct downloads (the notarized Mac DMG): ios/scripts/mac-dmg.sh → site-downloads/ (git-ignored).
const downloads = fs.existsSync("site-downloads") ? fs.readdirSync("site-downloads").filter((f) => !f.startsWith(".")) : [];
if (downloads.length) {
  fs.mkdirSync(path.join(out, "download"), { recursive: true });
  for (const f of downloads) fs.copyFileSync(path.join("site-downloads", f), path.join(out, "download", f));
}

await build({
  entryPoints: ["deploy/cf/pages.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "neutral",
  outfile: path.join(out, "_worker.js"),
});

// Static files skip the function entirely (free-tier requests are for the API).
const statics = ["/app/bundle.js", "/demo.svg", ...downloads.map((f) => `/download/${f}`), ...fs.readdirSync(path.join(out, "app")).filter((f) => f.endsWith(".png")).map((f) => `/app/${f}`)];
fs.writeFileSync(path.join(out, "_routes.json"), JSON.stringify({ version: 1, include: ["/*"], exclude: statics }, null, 2));
console.log(`[build-cf] ${out}: ${fs.readdirSync(out).join(", ")}`);
