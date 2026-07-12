/**
 * The sync relay: a deliberately dumb ciphertext store.
 *
 * It knows accounts (public keys), devices (certified public keys), space
 * ids, sealed key blobs, and encrypted update blobs with sequence numbers.
 * It can never read a note, a space name, or a key — there is no plaintext
 * field in the schema. Self-hostable: `vortex-notes relay --port 7300`.
 *
 * Auth: every request (except /v1/register and /health) carries
 *   x-vortex-device: device Ed25519 pub (hex)
 *   x-vortex-ts:     unix ms
 *   x-vortex-sig:    ed25519 over "METHOD\npath?query\nts\nsha256(body)hex"
 * Registration itself is authorized by the account signature on the device
 * certificate — the same chain of trust every later request hangs off.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { sha256 } from "@noble/hashes/sha2.js";
import { verify, fromHex, toHex, utf8 } from "../crypto.js";
import { verifyDeviceCert, type DeviceCertPayload } from "../identity.js";

const MAX_BODY = 8 * 1024 * 1024;
const MAX_SKEW_MS = 5 * 60 * 1000;

export interface RelayOptions {
  port: number;
  dbPath?: string; // default in-memory
}

export async function startRelay(
  opts: RelayOptions
): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  if (opts.dbPath) fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
  const db = new Database(opts.dbPath ?? ":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      signPub TEXT PRIMARY KEY,
      encPub TEXT NOT NULL,
      account TEXT NOT NULL,
      cert TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      account TEXT NOT NULL,
      sealedKeys TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS updates (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      space TEXT NOT NULL,
      doc TEXT NOT NULL,
      author TEXT NOT NULL,
      blob BLOB NOT NULL,
      ts TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS updates_space_seq ON updates(space, seq);
  `);

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => void handle(req, res, Buffer.concat(chunks)).catch((err) => {
      sendJson(res, 500, { error: (err as Error).message });
    }));
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer): Promise<void> {
    const url = new URL(req.url ?? "/", "http://relay");
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /health") return sendJson(res, 200, { ok: true });

    if (route === "GET /" || route === "GET /app") {
      const nonce = crypto.randomBytes(16).toString("base64");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'`,
      });
      return void res.end(appShell(nonce));
    }
    if (route === "GET /app/bundle.js") {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const bundle = [
        path.join(here, "../webapp/bundle.js"), // dist/relay → dist/webapp
        path.join(process.cwd(), "dist/webapp/bundle.js"), // test builds
      ].find((p) => fs.existsSync(p));
      if (!bundle) return sendJson(res, 404, { error: "Web app bundle not built (npm run build)" });
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      return void res.end(fs.readFileSync(bundle));
    }

    if (route === "POST /v1/register") {
      const b = parse(body);
      const accountSignPub = String(b.accountSignPub ?? "");
      const accountEncPub = String(b.accountEncPub ?? "");
      const device = b.device as (DeviceCertPayload & { certSig: string }) | undefined;
      if (!accountSignPub || !accountEncPub || !device) {
        return sendJson(res, 400, { error: "accountSignPub, accountEncPub, device required" });
      }
      if (!verifyDeviceCert(fromHex(accountSignPub), device)) {
        return sendJson(res, 401, { error: "Device certificate not signed by that account" });
      }
      db.prepare(
        `INSERT INTO devices (signPub, encPub, account, cert, createdAt) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(signPub) DO UPDATE SET cert=excluded.cert`
      ).run(device.signPub, device.encPub, accountSignPub, JSON.stringify(device), new Date().toISOString());
      return sendJson(res, 200, { ok: true });
    }

    // --- everything below requires a signed request from a registered device ---
    const auth = authenticate(req, url, body);
    if ("error" in auth) return sendJson(res, 401, { error: auth.error });
    const { account, devicePub } = auth;

    const rawMatch = url.pathname.match(/^\/v1\/spaces\/([a-z0-9-]+)(?:\/docs\/([A-Za-z0-9._%-]+))?$/);
    const spaceMatch = rawMatch
      ? ([rawMatch[0], rawMatch[1], rawMatch[2] ? decodeURIComponent(rawMatch[2]) : undefined] as const)
      : null;

    if (route === "GET /v1/spaces") {
      const rows = db.prepare("SELECT id, sealedKeys, createdAt FROM spaces WHERE account=?").all(account) as {
        id: string;
        sealedKeys: string;
        createdAt: string;
      }[];
      return sendJson(res, 200, {
        spaces: rows.map((r) => ({ id: r.id, sealedKeys: JSON.parse(r.sealedKeys), createdAt: r.createdAt })),
      });
    }

    if (req.method === "PUT" && spaceMatch && !spaceMatch[2]) {
      const id = spaceMatch[1];
      const b = parse(body);
      const sealedKeys = b.sealedKeys as Record<string, string> | undefined;
      if (!sealedKeys || typeof sealedKeys !== "object") return sendJson(res, 400, { error: "sealedKeys required" });
      const existing = db.prepare("SELECT account FROM spaces WHERE id=?").get(id) as { account: string } | undefined;
      if (existing && existing.account !== account) return sendJson(res, 403, { error: "Not your space" });
      db.prepare(
        `INSERT INTO spaces (id, account, sealedKeys, createdAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET sealedKeys=excluded.sealedKeys`
      ).run(id, account, JSON.stringify(sealedKeys), new Date().toISOString());
      return sendJson(res, 200, { ok: true });
    }

    if (spaceMatch) {
      const spaceId = spaceMatch[1];
      const owner = db.prepare("SELECT account FROM spaces WHERE id=?").get(spaceId) as { account: string } | undefined;
      if (!owner) return sendJson(res, 404, { error: `Unknown space ${spaceId}` });
      if (owner.account !== account) return sendJson(res, 403, { error: "Not your space" });

      if (req.method === "POST" && spaceMatch[2]) {
        const b = parse(body);
        const blob = Buffer.from(String(b.blob ?? ""), "base64");
        if (!blob.length) return sendJson(res, 400, { error: "blob (base64) required" });
        const info = db
          .prepare("INSERT INTO updates (space, doc, author, blob, ts) VALUES (?, ?, ?, ?, ?)")
          .run(spaceId, spaceMatch[2], devicePub, blob, new Date().toISOString());
        return sendJson(res, 200, { seq: Number(info.lastInsertRowid) });
      }

      if (req.method === "GET" && !spaceMatch[2]) {
        const since = Number(url.searchParams.get("since") ?? 0);
        const doc = url.searchParams.get("doc");
        const rows = (
          doc
            ? db.prepare("SELECT seq, doc, author, blob, ts FROM updates WHERE space=? AND doc=? AND seq>? ORDER BY seq LIMIT 500").all(spaceId, doc, since)
            : db.prepare("SELECT seq, doc, author, blob, ts FROM updates WHERE space=? AND seq>? ORDER BY seq LIMIT 500").all(spaceId, since)
        ) as { seq: number; doc: string; author: string; blob: Buffer; ts: string }[];
        return sendJson(res, 200, {
          updates: rows.map((r) => ({ seq: r.seq, doc: r.doc, author: r.author, ts: r.ts, blob: r.blob.toString("base64") })),
        });
      }
    }

    return sendJson(res, 404, { error: `No route: ${route}` });
  }

  function authenticate(
    req: http.IncomingMessage,
    url: URL,
    body: Buffer
  ): { account: string; devicePub: string } | { error: string } {
    const devicePub = String(req.headers["x-vortex-device"] ?? "");
    const ts = String(req.headers["x-vortex-ts"] ?? "");
    const sig = String(req.headers["x-vortex-sig"] ?? "");
    if (!devicePub || !ts || !sig) return { error: "Missing auth headers" };
    if (Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) return { error: "Timestamp skew too large" };
    const canonical = `${req.method}\n${url.pathname}${url.search}\n${ts}\n${toHex(sha256(body))}`;
    let ok = false;
    try {
      ok = verify(fromHex(sig), utf8(canonical), fromHex(devicePub));
    } catch {
      ok = false;
    }
    if (!ok) return { error: "Bad signature" };
    const row = db.prepare("SELECT account FROM devices WHERE signPub=?").get(devicePub) as
      | { account: string }
      | undefined;
    if (!row) return { error: "Device not registered" };
    return { account: row.account, devicePub };
  }

  await new Promise<void>((resolve) => server.listen(opts.port, resolve));
  const port = (server.address() as { port: number }).port;
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  };
  return { server, port, close };
}

function parse(body: Buffer): Record<string, unknown> {
  try {
    return JSON.parse(body.toString("utf8") || "{}");
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function appShell(_nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vortex Notes</title>
<style>
  :root {
    --ground:#F8FAF8; --surface:#FFFFFF; --ink:#1D2421; --ink-soft:#4A554F; --ink-faint:#75817A;
    --line:#DFE6E1; --accent:#14735C; --accent-soft:#E3F0EB; --code-bg:#F0F4F1; --danger:#A33B2E;
    --mono:ui-monospace,"SF Mono",Menlo,monospace;
    --serif:"Charter","Iowan Old Style",Georgia,serif;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  }
  [data-theme="dark"] {
    --ground:#121715; --surface:#1A211E; --ink:#E6ECE8; --ink-soft:#ACB8B1; --ink-faint:#7D8A83;
    --line:#2C3531; --accent:#4CC2A0; --accent-soft:#1C2F29; --code-bg:#202824; --danger:#E08573;
  }
  * { box-sizing:border-box; } html,body { margin:0; height:100%; }
  body { background:var(--ground); color:var(--ink); font-family:var(--sans); }

  .mark { color:var(--accent); display:inline-flex; }
  .mark svg { width:20px; height:20px; display:block; }
  .mark .outer, .mark .inner { transform-origin:12px 12px; }
  .mark .outer { animation:vspin 14s linear infinite; }
  .mark .inner { animation:vspin-rev 9s linear infinite; }
  @keyframes vspin { to { transform:rotate(360deg); } }
  @keyframes vspin-rev { to { transform:rotate(-360deg); } }
  @media (prefers-reduced-motion: reduce) { .mark .outer, .mark .inner { animation:none; } }
  .wordmark { display:flex; align-items:center; gap:0.5rem; font:400 0.92rem var(--sans); }
  .wordmark .vx { color:var(--accent); font-weight:600; }
  .wordmark .nx { color:var(--ink-soft); margin-left:-0.2rem; }

  #lock { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:1.1rem; padding:1rem; }
  #lock .wordmark { font-size:1.35rem; }
  #lock p { color:var(--ink-soft); font-size:0.85rem; max-width:26rem; text-align:center; margin:0; line-height:1.55; }
  #phrase { width:min(30rem,90vw); padding:0.7rem 0.9rem; border:1px solid var(--line); border-radius:8px;
    background:var(--surface); color:var(--ink); font:0.9rem var(--mono); outline:none; }
  #phrase:focus { border-color:var(--accent); }
  #unlockBtn { background:var(--accent); color:#fff; border:none; border-radius:8px; padding:0.6rem 1.5rem;
    font:600 0.85rem var(--sans); cursor:pointer; }
  [data-theme="dark"] #unlockBtn { color:#10211C; }
  #status { font:0.75rem var(--mono); color:var(--ink-faint); min-height:1.2em; max-width:30rem; text-align:center; }

  #main { display:none; height:100vh; }
  aside { width:290px; flex:none; background:var(--surface); border-right:1px solid var(--line);
    display:flex; flex-direction:column; overflow-y:auto; }
  .bar { display:flex; gap:0.4rem; align-items:center; padding:0.95rem 1rem 0.7rem; }
  .bar .wordmark { margin-right:auto; }
  .iconbtn { background:none; border:1px solid var(--line); border-radius:6px; color:var(--ink-soft);
    height:27px; min-width:27px; cursor:pointer; font-size:0.85rem; padding:0 0.35rem; }
  .iconbtn:hover { border-color:var(--accent); color:var(--accent); }
  #filter { margin:0 1rem 0.6rem; padding:0.48rem 0.7rem; border:1px solid var(--line); border-radius:7px;
    background:var(--ground); color:var(--ink); font:0.83rem var(--sans); outline:none; }
  #filter:focus { border-color:var(--accent); }
  #list { flex:1; padding:0 0.5rem 1rem; }
  .folder { font:600 0.62rem var(--mono); letter-spacing:0.12em; text-transform:uppercase;
    color:var(--ink-faint); padding:0.9rem 0.5rem 0.3rem; }
  #list a { display:block; padding:0.32rem 0.5rem; border-radius:6px; color:var(--ink-soft); font-size:0.86rem;
    text-decoration:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #list a:hover { background:var(--accent-soft); color:var(--ink); }
  #list a.active { background:var(--accent-soft); color:var(--accent); font-weight:600; }
  .empty { color:var(--ink-faint); font-size:0.8rem; padding:0.5rem; }
  .dailybox { padding:0.75rem 1rem; border-top:1px solid var(--line); }
  .dailybox label { display:block; font:600 0.6rem var(--mono); letter-spacing:0.12em; text-transform:uppercase;
    color:var(--ink-faint); margin-bottom:0.35rem; }
  .dailybox input { width:100%; padding:0.45rem 0.65rem; border:1px solid var(--line); border-radius:7px;
    background:var(--ground); color:var(--ink); font:0.8rem var(--sans); outline:none; }
  .dailybox input:focus { border-color:var(--accent); }

  main.pane { flex:1; overflow-y:auto; }
  #note { max-width:46rem; margin:0 auto; padding:3rem 2.2rem 6rem; }
  .placeholder { color:var(--ink-faint); font:1rem var(--serif); font-style:italic; margin-top:30vh; text-align:center; }
  .notehead { border-bottom:1px solid var(--line); padding-bottom:1rem; margin-bottom:1.6rem; }
  .notehead .meta { font:0.7rem var(--mono); color:var(--ink-faint); letter-spacing:0.05em;
    display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap; }
  .notehead .meta .path { margin-right:auto; }
  .notehead h1 { font:700 2rem/1.15 var(--serif); letter-spacing:-0.015em; margin:0.4rem 0 0; }
  .mbtn { background:none; border:1px solid var(--line); border-radius:6px; color:var(--ink-soft);
    font:0.68rem var(--mono); padding:0.2rem 0.55rem; cursor:pointer; }
  .mbtn:hover { border-color:var(--accent); color:var(--accent); }
  .mbtn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  [data-theme="dark"] .mbtn.primary { color:#10211C; }

  article { font:1.02rem/1.68 var(--serif); }
  article h1, article h2, article h3, article h4 { font-family:var(--serif); letter-spacing:-0.01em;
    line-height:1.25; margin:1.8em 0 0.5em; }
  article h1 { font-size:1.55rem; } article h2 { font-size:1.3rem; } article h3 { font-size:1.1rem; }
  article p { margin:0 0 1em; }
  article a { color:var(--accent); }
  article code { font:0.85em var(--mono); background:var(--code-bg); border-radius:4px; padding:0.1em 0.35em; }
  article pre { background:var(--code-bg); border:1px solid var(--line); border-radius:8px; padding:1rem 1.2rem; overflow-x:auto; }
  article pre code { background:none; padding:0; }
  article blockquote { margin:1em 0; padding:0.1em 1.2em; border-left:3px solid var(--accent); color:var(--ink-soft); }
  article img { max-width:100%; border-radius:6px; }
  article hr { border:none; border-top:1px solid var(--line); margin:2em 0; }
  article table { border-collapse:collapse; width:100%; font-size:0.92rem; }
  article th, article td { border:1px solid var(--line); padding:0.45rem 0.7rem; text-align:left; }
  article th { background:var(--code-bg); font-family:var(--sans); font-size:0.8rem; }
  article ul, article ol { padding-left:1.5rem; }
  article li { margin-bottom:0.3em; }
  article del { color:var(--ink-faint); }
  article input[type=checkbox] { accent-color:var(--accent); }
  pre.rawview { font:0.82rem/1.6 var(--mono); white-space:pre-wrap; word-break:break-word; }

  #cm { border:1px solid var(--line); border-radius:8px; background:var(--surface); overflow:hidden; }
  #cm .cm-editor { min-height:60vh; }
  #cm .cm-gutters { background:var(--surface); border-right:1px solid var(--line); color:var(--ink-faint); }
  #cm .cm-activeLine, #cm .cm-activeLineGutter { background:var(--accent-soft); }
  #cm .cm-cursor { border-left-color:var(--accent); }
  .editnote { font:0.72rem var(--mono); color:var(--ink-faint); margin-top:0.5rem; }

  @media (max-width:720px) {
    #main { flex-direction:column; }
    aside { width:100%; max-height:45vh; border-right:none; border-bottom:1px solid var(--line); }
    #note { padding:1.5rem 1.2rem 4rem; }
  }
</style>
</head>
<body>
<div id="lock">
  <div class="wordmark">${MARK_SVG}<span class="vx">Vortex</span> <span class="nx">Notes</span></div>
  <p>Enter your recovery phrase. Keys are derived in this tab — the phrase never leaves your browser, and this server only stores ciphertext.</p>
  <input id="phrase" type="password" placeholder="twelve words separated by spaces" autocomplete="off">
  <button id="unlockBtn">Unlock</button>
  <div id="status"></div>
</div>
<div id="main">
  <aside>
    <div class="bar">
      <div class="wordmark">${MARK_SVG}<span class="vx">Vortex</span> <span class="nx">Notes</span></div>
      <button class="iconbtn" id="newBtn" title="New note">＋</button>
      <button class="iconbtn" id="refreshBtn" title="Pull latest">⟳</button>
      <button class="iconbtn" id="themeBtn" title="Theme">◐</button>
      <button class="iconbtn" id="lockBtn" title="Lock">🔒</button>
    </div>
    <input id="filter" placeholder="Filter notes…" autocomplete="off">
    <nav id="list"></nav>
    <div class="dailybox">
      <label for="daily">Daily note — press Enter</label>
      <input id="daily" placeholder="Quick thought…" autocomplete="off">
    </div>
  </aside>
  <main class="pane" id="pane"><div id="note"><div class="placeholder">Select a note, or create one with ＋</div></div></main>
</div>
<script src="/app/bundle.js"></script>
</body>
</html>`;
}

const MARK_SVG = `<span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<g class="outer" stroke="currentColor" stroke-width="2" stroke-linecap="round">
<path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12"/>
<path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12" transform="rotate(120 12 12)"/>
<path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12" transform="rotate(240 12 12)"/>
</g>
<g class="inner" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5">
<path d="M12 6.75 A5.25 5.25 0 0 1 17.25 12"/>
<path d="M12 6.75 A5.25 5.25 0 0 1 17.25 12" transform="rotate(120 12 12)"/>
<path d="M12 6.75 A5.25 5.25 0 0 1 17.25 12" transform="rotate(240 12 12)"/>
</g>
<circle cx="12" cy="12" r="1.6" fill="currentColor"/>
</svg></span>`;
