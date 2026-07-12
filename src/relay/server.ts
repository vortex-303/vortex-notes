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
    --line:#DFE6E1; --accent:#14735C; --accent-soft:#E3F0EB; --code-bg:#F0F4F1;
    --mono:ui-monospace,"SF Mono",Menlo,monospace;
    --serif:"Charter","Iowan Old Style",Georgia,serif;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  }
  [data-theme="dark"] {
    --ground:#121715; --surface:#1A211E; --ink:#E6ECE8; --ink-soft:#ACB8B1; --ink-faint:#7D8A83;
    --line:#2C3531; --accent:#4CC2A0; --accent-soft:#1C2F29; --code-bg:#202824;
  }
  * { box-sizing:border-box; } html,body { margin:0; height:100%; }
  body { background:var(--ground); color:var(--ink); font-family:var(--sans); }
  #lock { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:1rem; padding:1rem; }
  #lock h1 { font:400 1.4rem var(--sans); margin:0; } #lock h1 b { color:var(--accent); font-weight:600; }
  #lock p { color:var(--ink-soft); font-size:0.85rem; max-width:26rem; text-align:center; margin:0; }
  #phrase { width:min(30rem,90vw); padding:0.7rem 0.9rem; border:1px solid var(--line); border-radius:8px;
    background:var(--surface); color:var(--ink); font:0.9rem var(--mono); outline:none; }
  #phrase:focus { border-color:var(--accent); }
  #unlockBtn { background:var(--accent); color:#fff; border:none; border-radius:8px; padding:0.6rem 1.4rem;
    font:600 0.85rem var(--sans); cursor:pointer; }
  #status { font:0.75rem var(--mono); color:var(--ink-faint); min-height:1.2em; }
  #main { display:none; height:100vh; }
  aside { width:280px; flex:none; background:var(--surface); border-right:1px solid var(--line);
    display:flex; flex-direction:column; overflow-y:auto; }
  .bar { display:flex; gap:0.4rem; align-items:center; padding:0.9rem 1rem 0.6rem; }
  .bar h1 { font:400 0.9rem var(--sans); margin:0 auto 0 0; } .bar h1 b { color:var(--accent); font-weight:600; }
  .bar button { background:none; border:1px solid var(--line); border-radius:6px; color:var(--ink-soft);
    height:26px; min-width:26px; cursor:pointer; font-size:0.8rem; }
  .bar button:hover { border-color:var(--accent); color:var(--accent); }
  #filter { margin:0 1rem 0.6rem; padding:0.45rem 0.7rem; border:1px solid var(--line); border-radius:7px;
    background:var(--ground); color:var(--ink); font:0.82rem var(--sans); outline:none; }
  #list { flex:1; padding:0 0.5rem 1rem; }
  #list a { display:block; padding:0.3rem 0.5rem; border-radius:6px; color:var(--ink-soft); font-size:0.84rem;
    text-decoration:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #list a:hover, #list a.active { background:var(--accent-soft); color:var(--accent); }
  .empty { color:var(--ink-faint); font-size:0.8rem; padding:0.5rem; }
  main.pane { flex:1; overflow-y:auto; }
  #note { max-width:44rem; margin:0 auto; padding:3rem 2rem 5rem; }
  .notehead { border-bottom:1px solid var(--line); padding-bottom:0.8rem; margin-bottom:1.4rem; }
  .notehead .path { font:0.7rem var(--mono); color:var(--ink-faint); }
  article { font:1rem/1.65 var(--serif); }
  article h1,article h2,article h3 { line-height:1.25; margin:1.6em 0 0.5em; }
  article a { color:var(--accent); }
  article code { font:0.85em var(--mono); background:var(--code-bg); border-radius:4px; padding:0.1em 0.3em; }
  article pre { background:var(--code-bg); border:1px solid var(--line); border-radius:8px; padding:1rem; overflow-x:auto; }
  article blockquote { border-left:3px solid var(--accent); margin:1em 0; padding:0.1em 1.1em; color:var(--ink-soft); }
  article del { color:var(--ink-faint); }
</style>
</head>
<body>
<div id="lock">
  <h1><b>Vortex</b> Notes</h1>
  <p>Enter your recovery phrase. Keys are derived in this tab — the phrase never leaves your browser, and this server only stores ciphertext.</p>
  <input id="phrase" type="password" placeholder="twelve words separated by spaces" autocomplete="off">
  <button id="unlockBtn">Unlock</button>
  <div id="status"></div>
</div>
<div id="main">
  <aside>
    <div class="bar">
      <h1><b>Vortex</b> Notes</h1>
      <button id="refreshBtn" title="Pull latest">⟳</button>
      <button id="themeBtn" title="Theme">◐</button>
      <button id="lockBtn" title="Lock">🔒</button>
    </div>
    <input id="filter" placeholder="Filter…" autocomplete="off">
    <nav id="list"></nav>
  </aside>
  <main class="pane"><div id="note"><div class="empty" style="margin-top:30vh;text-align:center">Select a note.</div></div></main>
</div>
<script src="/app/bundle.js"></script>
</body>
</html>`;
}
