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
import { verifyDeviceCert, verifyAgentChain, type DeviceCertPayload, type SignedCert } from "../account.js";
import { landingShell } from "./landing.js";
import { renderPublicPage, type PublicTheme } from "./publicpage.js";
import { icon, ICON_CSS } from "../icons.js";
import { marked } from "marked";

const MAX_BODY = 8 * 1024 * 1024;
const MAX_SKEW_MS = 5 * 60 * 1000;

export interface RelayOptions {
  port: number;
  dbPath?: string; // default in-memory
  /** per-account ciphertext cap in bytes; undefined/0 = unlimited (self-host default) */
  quotaBytes?: number;
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
    CREATE TABLE IF NOT EXISTS accounts (
      account TEXT PRIMARY KEY,
      bytesUsed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS public_notes (
      slug TEXT PRIMARY KEY,
      account TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      theme TEXT NOT NULL DEFAULT 'manuscript',
      md TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS public_account_path ON public_notes(account, path);
    CREATE TABLE IF NOT EXISTS pair_requests (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      signPub TEXT NOT NULL,
      encPub TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      approvedBlob TEXT
    );
  `);

  // Backfill usage counters for accounts created before quotas existed.
  db.exec(
    "INSERT OR REPLACE INTO accounts (account, bytesUsed) " +
      "SELECT s.account, COALESCE(SUM(LENGTH(u.blob)), 0) " +
      "FROM spaces s LEFT JOIN updates u ON u.space = s.id GROUP BY s.account;"
  );
  const quota = opts.quotaBytes && opts.quotaBytes > 0 ? opts.quotaBytes : null;
  const usageOf = (account: string): number =>
    (db.prepare("SELECT bytesUsed FROM accounts WHERE account=?").get(account) as { bytesUsed: number } | undefined)
      ?.bytesUsed ?? 0;
  const addUsage = db.prepare(
    "INSERT INTO accounts (account, bytesUsed) VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET bytesUsed = bytesUsed + excluded.bytesUsed"
  );

  const PAIR_TTL_MS = 15 * 60 * 1000;
  const pruneAndGetPair = (code: string) => {
    db.prepare("DELETE FROM pair_requests WHERE createdAt < ?").run(Date.now() - PAIR_TTL_MS);
    return db.prepare("SELECT * FROM pair_requests WHERE code=?").get(code) as
      | { code: string; name: string; signPub: string; encPub: string; createdAt: number; approvedBlob: string | null }
      | undefined;
  };

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

    if (route === "GET /") {
      const nonce = crypto.randomBytes(16).toString("base64");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; img-src 'self' data:",
      });
      return void res.end(landingShell(nonce));
    }
    if (route === "GET /app") {
      const nonce = crypto.randomBytes(16).toString("base64");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'`,
        "Cache-Control": "no-cache",
      });
      return void res.end(appShell(nonce));
    }
    if (route === "GET /demo.svg") {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const f = [path.join(here, "../assets/demo.svg"), path.join(here, "../../assets/demo.svg"), path.join(process.cwd(), "assets/demo.svg")].find((p) => fs.existsSync(p));
      if (!f) return sendJson(res, 404, { error: "demo not built" });
      res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      return void res.end(fs.readFileSync(f));
    }
    if (route === "GET /app/manifest.webmanifest") {
      res.writeHead(200, { "Content-Type": "application/manifest+json" });
      return void res.end(JSON.stringify({
        name: "Vortex Notes",
        short_name: "Vortex",
        start_url: "/app",
        display: "standalone",
        background_color: "#121715",
        theme_color: "#14735C",
        icons: [{
          src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%23121715'/%3E%3Cg stroke='%234CC2A0' stroke-width='2' stroke-linecap='round' fill='none'%3E%3Cpath d='M12 3.5 A8.5 8.5 0 0 1 20.5 12'/%3E%3Cpath d='M12 3.5 A8.5 8.5 0 0 1 20.5 12' transform='rotate(120 12 12)'/%3E%3Cpath d='M12 3.5 A8.5 8.5 0 0 1 20.5 12' transform='rotate(240 12 12)'/%3E%3C/g%3E%3Ccircle cx='12' cy='12' r='1.8' fill='%234CC2A0'/%3E%3C/svg%3E",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        }],
      }));
    }
    if (route === "GET /app/bundle.js") {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const bundle = [
        path.join(here, "../webapp/bundle.js"), // dist/relay → dist/webapp
        path.join(process.cwd(), "dist/webapp/bundle.js"), // test builds
      ].find((p) => fs.existsSync(p));
      if (!bundle) return sendJson(res, 404, { error: "Web app bundle not built (npm run build)" });
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
      return void res.end(fs.readFileSync(bundle));
    }

    const pubMatch = url.pathname.match(/^\/p\/([a-z0-9-]+)$/);
    if (req.method === "GET" && pubMatch) {
      const row = db.prepare("SELECT * FROM public_notes WHERE slug=?").get(pubMatch[1]) as
        | { title: string; author: string | null; theme: string; md: string; updatedAt: string }
        | undefined;
      if (!row) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        return void res.end("<h1 style='font-family:serif;text-align:center;margin-top:20vh'>This note is no longer public.</h1>");
      }
      // Render markdown; strip script tags belt-and-braces — the CSP below is
      // the real guarantee that published content can't execute anything.
      let bodyHtml = marked.parse(row.md, { async: false }) as string;
      bodyHtml = bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, "");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src 'self'",
        "Cache-Control": "public, max-age=60",
      });
      return void res.end(
        renderPublicPage({
          title: row.title,
          author: row.author,
          theme: row.theme as PublicTheme,
          bodyHtml,
          updatedAt: row.updatedAt,
        })
      );
    }

    if (route === "POST /v1/pair/request") {
      const b = parse(body);
      const name = String(b.name ?? "agent").slice(0, 60);
      const signPub = String(b.signPub ?? "");
      const encPub = String(b.encPub ?? "");
      if (!/^[0-9a-f]{64}$/.test(signPub) || !/^[0-9a-f]{64}$/.test(encPub)) {
        return sendJson(res, 400, { error: "signPub and encPub (32-byte hex) required" });
      }
      const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
      let code = "";
      for (const byte of crypto.randomBytes(6)) code += alphabet[byte % alphabet.length];
      db.prepare("DELETE FROM pair_requests WHERE createdAt < ?").run(Date.now() - PAIR_TTL_MS);
      db.prepare("INSERT INTO pair_requests (code, name, signPub, encPub, createdAt) VALUES (?, ?, ?, ?, ?)")
        .run(code, name, signPub, encPub, Date.now());
      return sendJson(res, 200, { code, expiresInMs: PAIR_TTL_MS });
    }
    if (route === "GET /v1/pair/poll") {
      const code = url.searchParams.get("code") ?? "";
      const signPub = url.searchParams.get("signPub") ?? "";
      const row = pruneAndGetPair(code);
      if (!row) return sendJson(res, 404, { error: "Unknown or expired pairing code" });
      if (row.signPub !== signPub) return sendJson(res, 403, { error: "Not your pairing request" });
      if (!row.approvedBlob) return sendJson(res, 200, { status: "pending" });
      db.prepare("DELETE FROM pair_requests WHERE code=?").run(code);
      return sendJson(res, 200, { status: "approved", grant: row.approvedBlob });
    }

    if (route === "POST /v1/register") {
      const b = parse(body);
      const accountSignPub = String(b.accountSignPub ?? "");
      const accountEncPub = String(b.accountEncPub ?? "");
      const device = b.device as (DeviceCertPayload & { certSig: string }) | undefined;
      if (!accountSignPub || !accountEncPub || !device) {
        return sendJson(res, 400, { error: "accountSignPub, accountEncPub, device required" });
      }
      if (device.kind === "agent") {
        const chain = b.chain as SignedCert | undefined;
        if (!chain || !verifyAgentChain(fromHex(accountSignPub), device, chain)) {
          return sendJson(res, 401, { error: "Agent certificate chain is invalid" });
        }
      } else if (!verifyDeviceCert(fromHex(accountSignPub), device)) {
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
    const isAgent = auth.cert?.kind === "agent";
    const scope = isAgent ? auth.cert?.spaces ?? [] : null; // agents: only certified spaces
    const readOnly = isAgent && auth.cert?.mode === "ro";
    const inScope = (spaceId: string) => scope === null || scope.includes(spaceId);

    if (route === "GET /v1/pair/pending") {
      if (isAgent) return sendJson(res, 403, { error: "Agents cannot approve pairings" });
      const code = url.searchParams.get("code") ?? "";
      const row = pruneAndGetPair(code);
      if (!row) return sendJson(res, 404, { error: "Unknown or expired pairing code" });
      return sendJson(res, 200, { code: row.code, name: row.name, signPub: row.signPub, encPub: row.encPub });
    }
    if (route === "POST /v1/pair/approve") {
      if (isAgent) return sendJson(res, 403, { error: "Agents cannot approve pairings" });
      const b = parse(body);
      const code = String(b.code ?? "");
      const grant = String(b.grant ?? "");
      const row = pruneAndGetPair(code);
      if (!row) return sendJson(res, 404, { error: "Unknown or expired pairing code" });
      if (!grant) return sendJson(res, 400, { error: "grant (base64) required" });
      db.prepare("UPDATE pair_requests SET approvedBlob=? WHERE code=?").run(grant, code);
      return sendJson(res, 200, { ok: true });
    }

    if (route === "PUT /v1/public") {
      if (isAgent) return sendJson(res, 403, { error: "Agents cannot publish notes" });
      const b = parse(body);
      const notePath = String(b.path ?? "");
      const title = String(b.title ?? "Untitled").slice(0, 200);
      const author = b.author ? String(b.author).slice(0, 80) : null;
      const theme = ["manuscript", "vortex", "typewriter"].includes(String(b.theme)) ? String(b.theme) : "manuscript";
      const md = String(b.markdown ?? "");
      if (!notePath || !md) return sendJson(res, 400, { error: "path and markdown required" });
      if (md.length > 500_000) return sendJson(res, 413, { error: "Note too large to publish" });
      const now = new Date().toISOString();
      const givenSlug = b.slug ? String(b.slug) : null;
      let row = givenSlug
        ? (db.prepare("SELECT slug, account, md FROM public_notes WHERE slug=?").get(givenSlug) as { slug: string; account: string; md: string } | undefined)
        : (db.prepare("SELECT slug, account, md FROM public_notes WHERE account=? AND path=?").get(account, notePath) as { slug: string; account: string; md: string } | undefined);
      if (row && row.account !== account) return sendJson(res, 403, { error: "Not your public note" });
      if (row) {
        if (quota && usageOf(account) + (md.length - row.md.length) > quota) {
          return sendJson(res, 413, { error: "Storage quota exceeded" });
        }
        db.prepare("UPDATE public_notes SET path=?, title=?, author=?, theme=?, md=?, updatedAt=? WHERE slug=?")
          .run(notePath, title, author, theme, md, now, row.slug);
        addUsage.run(account, md.length - row.md.length);
        return sendJson(res, 200, { slug: row.slug });
      }
      if (quota && usageOf(account) + md.length > quota) {
        return sendJson(res, 413, { error: "Storage quota exceeded" });
      }
      const base = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "note";
      const alphabet = "abcdefghjkmnpqrstvwxyz23456789";
      let suffix = "";
      for (const byte of crypto.randomBytes(4)) suffix += alphabet[byte % alphabet.length];
      const slug = base + "-" + suffix;
      db.prepare("INSERT INTO public_notes (slug, account, path, title, author, theme, md, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(slug, account, notePath, title, author, theme, md, now, now);
      addUsage.run(account, md.length);
      return sendJson(res, 200, { slug });
    }
    const delPubMatch = url.pathname.match(/^\/v1\/public\/([a-z0-9-]+)$/);
    if (req.method === "DELETE" && delPubMatch) {
      if (isAgent) return sendJson(res, 403, { error: "Agents cannot unpublish notes" });
      const row = db.prepare("SELECT account, md FROM public_notes WHERE slug=?").get(delPubMatch[1]) as { account: string; md: string } | undefined;
      if (!row) return sendJson(res, 404, { error: "No such public note" });
      if (row.account !== account) return sendJson(res, 403, { error: "Not your public note" });
      db.prepare("DELETE FROM public_notes WHERE slug=?").run(delPubMatch[1]);
      addUsage.run(account, -row.md.length);
      return sendJson(res, 200, { ok: true });
    }
    if (route === "GET /v1/public") {
      const rows = db.prepare("SELECT slug, path, title, author, theme, updatedAt FROM public_notes WHERE account=?").all(account);
      return sendJson(res, 200, { published: rows });
    }
    if (route === "GET /v1/usage") {
      return sendJson(res, 200, { bytesUsed: usageOf(account), quotaBytes: quota });
    }
    if (route === "GET /v1/principals") {
      const rows = db.prepare("SELECT signPub, cert, createdAt FROM devices WHERE account=?").all(account) as {
        signPub: string;
        cert: string;
        createdAt: string;
      }[];
      return sendJson(res, 200, {
        principals: rows.map((r) => {
          const c = JSON.parse(r.cert) as SignedCert;
          return { signPub: r.signPub, name: c.name, kind: c.kind ?? "device", spaces: c.spaces, mode: c.mode, registeredAt: r.createdAt };
        }),
      });
    }
    const principalMatch = url.pathname.match(/^\/v1\/principals\/([0-9a-f]+)$/);
    if (req.method === "DELETE" && principalMatch) {
      if (isAgent) return sendJson(res, 403, { error: "Agents cannot revoke principals" });
      const gone = db.prepare("DELETE FROM devices WHERE signPub=? AND account=?").run(principalMatch[1], account);
      return sendJson(res, gone.changes ? 200 : 404, gone.changes ? { ok: true } : { error: "No such principal" });
    }

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
        spaces: rows
          .filter((r) => inScope(r.id))
          .map((r) => ({ id: r.id, sealedKeys: JSON.parse(r.sealedKeys), createdAt: r.createdAt })),
      });
    }

    if (req.method === "PUT" && spaceMatch && !spaceMatch[2]) {
      if (isAgent) return sendJson(res, 403, { error: "Agents cannot modify space membership" });
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
      if (!inScope(spaceId)) return sendJson(res, 403, { error: "This agent is not granted that space" });

      if (req.method === "POST" && spaceMatch[2]) {
        if (readOnly) return sendJson(res, 403, { error: "This agent is read-only" });
        const b = parse(body);
        const blob = Buffer.from(String(b.blob ?? ""), "base64");
        if (!blob.length) return sendJson(res, 400, { error: "blob (base64) required" });
        if (quota && usageOf(account) + blob.length > quota) {
          return sendJson(res, 413, {
            error: "Storage quota exceeded (" + Math.round(quota / 1e6) + "MB). Delete notes or upgrade.",
          });
        }
        const info = db
          .prepare("INSERT INTO updates (space, doc, author, blob, ts) VALUES (?, ?, ?, ?, ?)")
          .run(spaceId, spaceMatch[2], devicePub, blob, new Date().toISOString());
        addUsage.run(account, blob.length);
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
  ): { account: string; devicePub: string; cert: SignedCert | null } | { error: string } {
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
    const row = db.prepare("SELECT account, cert FROM devices WHERE signPub=?").get(devicePub) as
      | { account: string; cert: string }
      | undefined;
    if (!row) return { error: "Device not registered" };
    let cert: SignedCert | null = null;
    try {
      cert = JSON.parse(row.cert) as SignedCert;
    } catch { /* legacy rows */ }
    return { account: row.account, devicePub, cert };
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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F8FAF8">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121715">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Vortex Notes">
<link rel="manifest" href="/app/manifest.webmanifest">
<link rel="icon" href="data:image/svg+xml,%3Csvg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cg stroke='%2314735C' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12'/%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12' transform='rotate(120 12 12)'/%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12' transform='rotate(240 12 12)'/%3E%3C/g%3E%3Ccircle cx='12' cy='12' r='2.2' fill='%2314735C'/%3E%3C/svg%3E">
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
  #unlockView, #createView { display:flex; flex-direction:column; align-items:center; gap:1.1rem; }
  #createView[hidden], #unlockView[hidden] { display:none; }
  .linkbtn { background:none; border:none; color:var(--accent); font:0.8rem var(--sans);
    cursor:pointer; text-decoration:underline; text-underline-offset:3px; padding:0.4rem; }
  .phrasebox { max-width:min(30rem,90vw); background:var(--surface); border:1px solid var(--accent);
    border-radius:10px; padding:1rem 1.2rem; font:600 1rem/1.9 var(--mono); color:var(--ink);
    text-align:center; user-select:all; -webkit-user-select:all; }
  .confirmrow { display:flex; gap:0.6rem; align-items:center; font-size:0.85rem; color:var(--ink-soft); cursor:pointer; }
  .confirmrow input { width:20px; height:20px; accent-color:var(--accent); }
  #createBtn { background:var(--accent); color:#fff; border:none; border-radius:8px; padding:0.6rem 1.5rem;
    font:600 0.85rem var(--sans); cursor:pointer; }
  #createBtn:disabled { opacity:0.45; cursor:default; }
  [data-theme="dark"] #createBtn { color:#10211C; }

  #main { display:none; height:100vh; }
  aside { width:290px; flex:none; background:var(--surface); border-right:1px solid var(--line);
    display:flex; flex-direction:column; overflow-y:auto; }
  .bar { display:flex; gap:0.4rem; align-items:center; padding:0.95rem 1rem 0.7rem; }
  .bar .wordmark { margin-right:auto; }
  .iconbtn { background:none; border:1px solid var(--line); border-radius:6px; color:var(--ink-soft);
    height:27px; min-width:27px; cursor:pointer; font-size:0.85rem; padding:0 0.35rem; }
  .iconbtn:hover { border-color:var(--accent); color:var(--accent); }
  ${ICON_CSS}
  .iconbtn { display:inline-flex; align-items:center; justify-content:center; }
  .iconbtn .ic { width:18px; height:18px; }
  .menuitem .ic { width:16px; height:16px; color:var(--ink-faint); margin-right:0.1rem; }
  .mbtn { display:inline-flex; align-items:center; gap:0.3rem; }
  .mbtn .ic { width:15px; height:15px; }
  .notemenu .menuitem { display:flex; align-items:center; gap:0.5rem; }
  .notemenu .menuitem .ic { width:16px; height:16px; color:var(--ink-faint); }
  .listlock { width:0.85em; height:0.85em; color:var(--ink-faint); vertical-align:-0.12em; }
  .lockscreen .lockicon .ic { width:2rem; height:2rem; color:var(--ink-faint); }
  .backbtn .ic { width:14px; height:14px; }
  .menuitem:hover .ic, .menuitem:hover { color:var(--accent); }
  /* bottom-left user menu */
  .usermenuwrap { position:relative; border-top:1px solid var(--line); flex:none; }
  .usertrigger { display:flex; align-items:center; gap:0.55rem; width:100%; padding:0.7rem 1rem;
    background:none; border:none; cursor:pointer; color:var(--ink); text-align:left; }
  .usertrigger:hover { background:var(--ground); }
  .avatar { width:26px; height:26px; border-radius:7px; flex:none; overflow:hidden;
    display:inline-flex; background:var(--accent-soft); }
  .avatar svg { width:100%; height:100%; display:block; }
  .uname { font:600 0.82rem var(--sans); margin-right:auto; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; max-width:12rem; }
  .umore { color:var(--ink-faint); width:1rem; height:1rem; }
  .usermenu { position:absolute; bottom:calc(100% + 4px); left:0.6rem; right:0.6rem; z-index:20;
    background:var(--surface); border:1px solid var(--line); border-radius:11px;
    box-shadow:0 12px 34px rgba(0,0,0,0.2); padding:0.25rem; }
  .usermenu[hidden] { display:none; }
  .umsection { padding:0.15rem; } .umsection + .umsection { border-top:1px solid var(--line); }
  .usermenu .menuitem { display:flex; align-items:center; gap:0.6rem; width:100%; text-align:left;
    background:none; border:none; color:var(--ink); font:0.85rem var(--sans); padding:0.55rem 0.7rem;
    border-radius:7px; cursor:pointer; }
  .usermenu .menuitem:hover { background:var(--accent-soft); }
  .usermenu .menuitem.static { cursor:default; } .usermenu .menuitem.static:hover { background:none; }
  .umval { margin-left:auto; color:var(--ink-faint); font:0.72rem var(--mono); }
  .agentslist { display:flex; flex-direction:column; gap:0.5rem; margin:0.6rem 0; }
  .agentrow { display:flex; align-items:center; gap:0.6rem; padding:0.6rem 0.7rem;
    border:1px solid var(--line); border-radius:9px; }
  .agentrow .ic { width:18px; height:18px; color:var(--ink-faint); }
  .agentrow .an { font:600 0.85rem var(--sans); }
  .agentrow .am { font:0.68rem var(--mono); color:var(--ink-faint); }
  .agentrow .col { flex:1; min-width:0; } .agentrow .col > * { display:block; }
  #agentsOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:56;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #agentsOverlay[hidden] { display:none; }
  #agentsModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:27rem; width:100%; max-height:86dvh; overflow-y:auto; padding:1.1rem 1.25rem 1.25rem;
    box-shadow:0 18px 50px rgba(0,0,0,0.35); }
  @media (max-width:720px) {
    #agentsOverlay { align-items:flex-end; padding:0; }
    #agentsModal { border-radius:16px 16px 0 0; max-width:none; padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }
  .menuwrap { position:relative; }
  .menu { position:absolute; right:0; top:calc(100% + 6px); z-index:20; min-width:11.5rem;
    background:var(--surface); border:1px solid var(--line); border-radius:10px;
    box-shadow:0 8px 28px rgba(0,0,0,0.18); padding:0.35rem; }
  .menuitem { display:block; width:100%; text-align:left; background:none; border:none;
    color:var(--ink); font:0.88rem var(--sans); padding:0.65rem 0.8rem; border-radius:7px;
    cursor:pointer; }
  .menuitem:hover { background:var(--accent-soft); color:var(--accent); }
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
  #note { position:relative; max-width:46rem; margin:0 auto; padding:3rem 2.2rem 6rem; }
  .placeholder { color:var(--ink-faint); font:1rem var(--serif); font-style:italic; margin-top:30vh; text-align:center; }
  .notehead { border-bottom:1px solid var(--line); padding-bottom:1rem; margin-bottom:1.6rem; }
  .notehead .meta { font:0.7rem var(--mono); color:var(--ink-faint); letter-spacing:0.05em;
    display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap; }
  .notehead .meta .path { margin-right:auto; }
  .notehead h1 { font:700 2rem/1.15 var(--serif); letter-spacing:-0.015em; margin:0.4rem 0 0; }
  .notemeta { font:0.72rem/1.5 var(--mono); color:var(--ink-faint); margin-top:0.45rem; letter-spacing:0.02em; }
  .lockscreen { text-align:center; margin-top:14vh; display:flex; flex-direction:column;
    align-items:center; gap:0.8rem; }
  .lockscreen .lockicon { font-size:2.2rem; }
  .lockscreen p { color:var(--ink-soft); margin:0; }
  .lockscreen input { width:min(20rem,80vw); padding:0.6rem 0.9rem; border:1px solid var(--line);
    border-radius:8px; background:var(--surface); color:var(--ink); font:1rem var(--sans); outline:none; text-align:center; }
  .lockscreen input:focus { border-color:var(--accent); }
  .lockerr { font:0.8rem var(--mono); color:var(--danger); min-height:1.2em; }
  .moremenu { position:relative; display:inline-flex; }
  .notemenu { position:absolute; top:calc(100% + 6px); right:0; z-index:20; min-width:12rem;
    background:var(--surface); border:1px solid var(--line); border-radius:10px;
    box-shadow:0 8px 28px rgba(0,0,0,0.18); padding:0.35rem; }
  .notemenu[hidden] { display:none; }
  .notemenu .menuitem { display:block; width:100%; text-align:left; background:none; border:none;
    color:var(--ink); font:0.85rem var(--sans); padding:0.6rem 0.75rem; border-radius:7px; cursor:pointer; }
  .notemenu .menuitem:hover { background:var(--accent-soft); color:var(--accent); }
  .mbtn { background:none; border:1px solid var(--line); border-radius:6px; color:var(--ink-soft);
    font:0.68rem var(--mono); padding:0.2rem 0.55rem; cursor:pointer; }
  .mbtn:hover { border-color:var(--accent); color:var(--accent); }
  .mbtn.danger:hover { border-color:var(--danger); color:var(--danger); }
  .mbtn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  [data-theme="dark"] .mbtn.primary { color:#10211C; }

  article { font:1.02rem/1.68 var(--serif); cursor:text; }
  #savestate { font:0.68rem var(--mono); color:var(--ink-faint); }
  .backbtn { display:none; }
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

  /* Live editor: invisible chrome — the note is the editing surface */
  #cm { border:none; background:transparent; }
  #cm .cm-editor { min-height:55vh; }
  .cm-bullet { color:var(--accent); display:inline-block; width:1em; }
  .cm-wikilink { color:var(--accent); border-bottom:1px solid var(--accent); cursor:pointer; }
  .cm-frontmatter { font:0.7rem var(--mono); color:var(--ink-faint); letter-spacing:0.05em;
    padding:0.25rem 0 0.6rem; cursor:pointer; user-select:none; }
  .cm-frontmatter:hover { color:var(--accent); }
  .editnote { font:0.72rem var(--mono); color:var(--ink-faint); margin-top:0.5rem; }

  #acctOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:50;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #acctOverlay[hidden] { display:none; }
  #acctModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:27rem; width:100%; padding:1.1rem 1.25rem 1.25rem; box-shadow:0 18px 50px rgba(0,0,0,0.3); }
  .acctphrase { margin:0.8rem 0; }
  .acctlabel { font:600 0.6rem var(--mono); letter-spacing:0.12em; text-transform:uppercase;
    color:var(--ink-faint); margin-bottom:0.4rem; }
  #phraseReveal.blurred { filter:blur(6px); cursor:pointer; user-select:none; color:var(--ink-faint); }
  .acctrow { display:flex; gap:1rem; margin-top:0.5rem; }
  @media (max-width:720px) {
    #acctOverlay { align-items:flex-end; padding:0; }
    #acctModal { border-radius:16px 16px 0 0; max-width:none;
      padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }
  #pubOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:55;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #pubOverlay[hidden] { display:none; }
  #pubModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:27rem; width:100%; max-height:88dvh; overflow-y:auto;
    padding:1.1rem 1.25rem 1.25rem; box-shadow:0 18px 50px rgba(0,0,0,0.35); }
  .pubname { border:none; border-bottom:1px solid var(--line); background:none; color:var(--ink);
    font:0.9rem var(--sans); outline:none; padding:0.2rem 0.1rem; width:14rem; }
  .pubname:focus { border-bottom-color:var(--accent); }
  .themerow { display:flex; gap:0.6rem; margin-top:0.3rem; }
  .themecard { flex:1; border:1px solid var(--line); border-radius:10px; padding:1.5rem 0.4rem 0.5rem;
    text-align:center; cursor:pointer; font:600 0.68rem var(--mono); position:relative; overflow:hidden; }
  .themecard input { position:absolute; opacity:0; }
  .themecard span { position:relative; z-index:1; }
  .themecard:has(input:checked) { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
  .t-manuscript { background:linear-gradient(174deg,#f4ead2,#e7d7b2); color:#5a4a28; }
  .t-vortex { background:radial-gradient(circle at 50% 0%,#12211c,#090f0d); color:#4CC2A0; }
  .t-typewriter { background:linear-gradient(180deg,#fbfaf5,#f0ede2); color:#b3382c; }
  .publink { display:flex; align-items:center; gap:0.6rem; }
  .publink a { color:var(--accent); font:0.8rem var(--mono); word-break:break-all; }
  @media (max-width:720px) {
    #pubOverlay { align-items:flex-end; padding:0; }
    #pubModal { border-radius:16px 16px 0 0; max-width:none; padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }
  #pwOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:60;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #pwOverlay[hidden] { display:none; }
  #pwModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:24rem; width:100%; padding:1.1rem 1.25rem 1.25rem; box-shadow:0 18px 50px rgba(0,0,0,0.35); }
  #pwModal .pairinput { text-transform:none; letter-spacing:normal; text-align:left; font-family:var(--sans); font-weight:400; }
  @media (max-width:720px) {
    #pwOverlay { align-items:flex-end; padding:0; }
    #pwModal { border-radius:16px 16px 0 0; max-width:none; padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }
  #pairOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:50;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #pairOverlay[hidden] { display:none; }
  #pairModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:26rem; width:100%; padding:1.1rem 1.25rem 1.25rem; box-shadow:0 18px 50px rgba(0,0,0,0.3); }
  .pairinput { width:100%; padding:0.7rem 0.9rem; border:1px solid var(--line); border-radius:8px;
    background:var(--ground); color:var(--ink); font:600 1.1rem var(--mono); letter-spacing:0.25em;
    text-transform:uppercase; text-align:center; outline:none; margin:0.4rem 0 0.7rem; }
  .pairinput:focus { border-color:var(--accent); }
  .pairgo { background:var(--accent); color:#fff; border:none; border-radius:8px;
    padding:0.55rem 1.2rem; font:600 0.85rem var(--sans); cursor:pointer; }
  [data-theme="dark"] .pairgo { color:#10211C; }
  #pairModal .confirmrow { margin:0.4rem 0; }
  @media (max-width:720px) {
    #pairOverlay { align-items:flex-end; padding:0; }
    #pairModal { border-radius:16px 16px 0 0; max-width:none;
      padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }
  #tipsOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:50;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #tipsOverlay[hidden] { display:none; }
  #tipsModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:26rem; width:100%; max-height:85dvh; overflow-y:auto; padding:1.1rem 1.25rem 1.25rem;
    box-shadow:0 18px 50px rgba(0,0,0,0.3); }
  .tipshead { display:flex; align-items:center; justify-content:space-between; margin-bottom:0.4rem; }
  .tipshead strong { font-size:1.05rem; }
  .tipsintro, .tipsfoot { font-size:0.83rem; color:var(--ink-soft); line-height:1.5; margin:0.4rem 0 0.8rem; }
  .tipsfoot { margin:0.9rem 0 0; }
  .tipstable { border-collapse:collapse; width:100%; font-size:0.86rem; }
  .tipstable td { padding:0.42rem 0.4rem; border-bottom:1px solid var(--line); vertical-align:top; }
  .tipstable tr:last-child td { border-bottom:none; }
  .tipstable td:first-child { white-space:nowrap; padding-right:0.9rem; }
  .tipstable code { font:0.82em var(--mono); background:var(--code-bg); border-radius:4px; padding:0.12em 0.4em; }
  @media (max-width:720px) {
    #tipsOverlay { align-items:flex-end; padding:0; }
    #tipsModal { border-radius:16px 16px 0 0; max-width:none;
      padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }

  @media (max-width:720px) {
    /* Two-screen navigation: list OR note, never a cramped split. */
    #main { display:flex; }
    aside { width:100%; height:100dvh; border-right:none;
      padding-top:env(safe-area-inset-top); padding-bottom:env(safe-area-inset-bottom); }
    #main .pane { display:none; }
    #main.note-open aside { display:none; }
    #main.note-open .pane { display:block; height:100dvh;
      padding-top:env(safe-area-inset-top); }
    .backbtn { display:inline-block; }
    #note { padding:1rem 1.1rem 6rem; }
    .notehead { position:sticky; top:0; background:var(--ground); z-index:2;
      padding-top:0.6rem; }
    .notehead h1 { font-size:1.5rem; }
    /* 16px inputs stop iOS zoom-on-focus; bigger touch targets everywhere */
    #filter, .dailybox input, #phrase { font-size:16px; }
    #list a { padding:0.62rem 0.6rem; font-size:1rem; }
    .folder { padding-top:1.1rem; }
    .iconbtn { height:44px; min-width:44px; font-size:1.15rem; border-radius:9px; }
    .mbtn { padding:0.55rem 0.95rem; font-size:0.8rem; min-height:40px; border-radius:8px; }
    .menuitem { padding:0.85rem 1rem; font-size:1rem; }
    .menu { min-width:13rem; }
    .bar { padding:0.8rem 0.9rem 0.6rem; gap:0.55rem; }
    .dailybox { position:sticky; bottom:0; background:var(--surface);
      padding-bottom:calc(0.75rem + env(safe-area-inset-bottom)); }
    #cm .cm-editor { min-height:70dvh; }
    article { font-size:1.05rem; }
  }
  @media (hover:hover) { article:hover { outline:1px dashed var(--line); outline-offset:8px; border-radius:4px; } }
</style>
</head>
<body>
<div id="lock">
  <div class="wordmark">${MARK_SVG}<span class="vx">Vortex</span> <span class="nx">Notes</span></div>
  <div id="unlockView">
    <p>Enter your recovery phrase. Keys are derived in this tab — the phrase never leaves your browser, and this server only stores ciphertext.</p>
    <input id="phrase" type="password" placeholder="twelve words separated by spaces" autocomplete="off">
    <button id="unlockBtn">Unlock</button>
    <button class="linkbtn" id="showCreateBtn">New here? Create an account</button>
  </div>
  <div id="createView" hidden>
    <p><strong>This is your account.</strong> Twelve words, generated in this tab, never stored anywhere. Write them down — anyone with them can read your notes, and there is no reset if they're lost.</p>
    <div id="newPhrase" class="phrasebox"></div>
    <button class="linkbtn" id="copyPhraseBtn">copy to clipboard</button>
    <label class="confirmrow"><input type="checkbox" id="savedCheck"> I wrote my phrase down somewhere safe</label>
    <button id="createBtn" disabled>Create my notes</button>
    <button class="linkbtn" id="backToUnlockBtn">I already have a phrase</button>
  </div>
  <div id="status"></div>
</div>
<div id="main">
  <aside>
    <div class="bar">
      <div class="wordmark">${MARK_SVG}<span class="vx">Vortex</span> <span class="nx">Notes</span></div>
      <button class="iconbtn" id="newBtn" title="New note">${icon("plus")}</button>
      <button class="iconbtn" id="refreshBtn" title="Pull latest">${icon("refresh")}</button>
    </div>
    <input id="filter" placeholder="Filter notes…" autocomplete="off">
    <nav id="list"></nav>
    <div class="usermenuwrap">
      <div class="usermenu" id="userMenu" hidden>
        <div class="umsection">
          <button class="menuitem" id="nameBtn">${icon("user")}<span>Display name</span><span class="umval" id="umName"></span></button>
          <button class="menuitem" id="acctBtn">${icon("key")}<span>Recovery phrase</span></button>
          <div class="menuitem static">${icon("storage")}<span>Storage</span><span class="umval" id="umStorage">—</span></div>
        </div>
        <div class="umsection">
          <button class="menuitem" id="agentsBtn">${icon("agent")}<span>Agents &amp; devices</span></button>
        </div>
        <div class="umsection">
          <button class="menuitem" id="themeBtn">${icon("theme")}<span>Theme</span></button>
          <button class="menuitem" id="tipsBtn">${icon("help")}<span>Markdown tips</span></button>
          <button class="menuitem" id="lockAllBtn">${icon("lock")}<span>Lock all notes</span></button>
          <button class="menuitem" id="lockBtn">${icon("signout")}<span>Sign out</span></button>
        </div>
      </div>
      <button class="usertrigger" id="userBtn" aria-haspopup="true">
        <span class="avatar" id="userAvatar"></span>
        <span class="uname" id="userLabel">Account</span>
        ${icon("more", "umore")}
      </button>
    </div>
  </aside>
  <main class="pane" id="pane"><div id="note"><div class="placeholder">Select a note, or create one with the + button.</div></div></main>
</div>
<div id="acctOverlay" hidden>
  <div id="acctModal" role="dialog" aria-label="Account and recovery">
    <div class="tipshead"><strong>Account &amp; recovery</strong><button class="iconbtn" id="acctClose" aria-label="Close">${icon("x")}</button></div>
    <p class="tipsintro">Account fingerprint <code id="acctFp"></code> — this confirms which account you're signed into.</p>
    <div class="acctphrase">
      <div class="acctlabel">Recovery phrase</div>
      <div id="phraseReveal" class="phrasebox blurred">tap to reveal</div>
      <div class="acctrow">
        <button class="linkbtn" id="acctCopy">copy</button>
        <button class="linkbtn" id="acctDownload">download .txt</button>
      </div>
    </div>
    <p class="tipsfoot">These 12 words <strong>are</strong> your account — anyone with them can read your
    notes, and there is no reset if they're lost. They are never sent to any server and never saved in
    this browser; to see them again after you close this tab, keep your own copy now.</p>
    <div id="acctNote" class="tipsfoot" hidden>Your phrase isn't held in this session. You saved it when
    you signed up — open the app fresh and it will ask for it.</div>
  </div>
</div>
<div id="pairOverlay" hidden>
  <div id="pairModal" role="dialog" aria-label="Pair an agent">
    <div class="tipshead"><strong>Pair an agent</strong><button class="iconbtn" id="pairClose" aria-label="Close">${icon("x")}</button></div>
    <div id="pairStep1">
      <p class="tipsintro">On the agent's machine, run
      <code>vortex-notes agent request --relay <span class="relayhost"></span> --name hermes</code>
      and type the 6-letter code it shows:</p>
      <input id="pairCode" class="pairinput" placeholder="e.g. KM3PXR" maxlength="6" autocomplete="off" autocapitalize="characters">
      <button id="pairLookup" class="pairgo">Look up</button>
    </div>
    <div id="pairStep2" hidden>
      <p class="tipsintro">Approve <strong id="pairName"></strong> for this space?</p>
      <label class="confirmrow"><input type="radio" name="pairMode" value="rw" checked> Read + write</label>
      <label class="confirmrow"><input type="radio" name="pairMode" value="ro"> Read-only (search &amp; read, never write)</label>
      <p class="tipsfoot">Its key: <code id="pairFp"></code> — every edit it makes will be signed with it and revocable.</p>
      <button id="pairApprove" class="pairgo">Approve</button>
    </div>
    <div id="pairStatus" class="tipsfoot"></div>
  </div>
</div>
<div id="agentsOverlay" hidden>
  <div id="agentsModal" role="dialog" aria-label="Agents and devices">
    <div class="tipshead"><strong>Agents &amp; devices</strong><button class="iconbtn" id="agentsClose" aria-label="Close">${icon("x")}</button></div>
    <p class="tipsintro">Everything that can reach your notes. Each device and agent has its own key — revoke any anytime; your account is unaffected.</p>
    <div id="agentsList" class="agentslist"></div>
    <button id="pairBtn" class="pairgo" style="margin-top:0.8rem">${icon("plus")} Pair an agent</button>
    <div id="agentsErr" class="lockerr"></div>
  </div>
</div>
<div id="pubOverlay" hidden>
  <div id="pubModal" role="dialog" aria-label="Public link">
    <div class="tipshead"><strong id="pubTitle">Make this note public</strong><button class="iconbtn" id="pubClose" aria-label="Close">${icon("x")}</button></div>
    <p class="tipsintro">Anyone with the link can read it. A readable copy is stored on the server —
    that's what "public" means. Edits you make re-publish automatically; unpublish removes it.</p>
    <div class="acctlabel">Signed as</div>
    <label class="confirmrow"><input type="radio" name="pubAuthor" value="name" checked>
      <input id="pubName" class="pubname" placeholder="Your display name" autocomplete="off"></label>
    <label class="confirmrow"><input type="radio" name="pubAuthor" value="anon"> Anonymous</label>
    <div class="acctlabel" style="margin-top:0.8rem">Theme</div>
    <div class="themerow">
      <label class="themecard t-manuscript"><input type="radio" name="pubTheme" value="manuscript" checked><span>Manuscript</span></label>
      <label class="themecard t-vortex"><input type="radio" name="pubTheme" value="vortex"><span>Vortex</span></label>
      <label class="themecard t-typewriter"><input type="radio" name="pubTheme" value="typewriter"><span>Typewriter</span></label>
    </div>
    <div id="pubLinkRow" hidden>
      <div class="acctlabel" style="margin-top:0.8rem">Public link</div>
      <div class="publink"><a id="pubLink" target="_blank" rel="noopener"></a><button class="linkbtn" id="pubCopy">copy</button></div>
    </div>
    <div id="pubErr" class="lockerr"></div>
    <div class="acctrow" style="margin-top:0.9rem">
      <button id="pubGo" class="pairgo">Publish</button>
      <button id="pubOff" class="mbtn danger" hidden>Unpublish</button>
    </div>
  </div>
</div>
<div id="pwOverlay" hidden>
  <div id="pwModal" role="dialog" aria-label="Password">
    <div class="tipshead"><strong id="pwTitle">Password</strong><button class="iconbtn" id="pwClose" aria-label="Close">${icon("x")}</button></div>
    <p id="pwHint" class="tipsintro"></p>
    <input id="pwInput" type="password" class="pairinput" placeholder="Password" autocomplete="new-password">
    <input id="pwConfirm" type="password" class="pairinput" placeholder="Confirm password" autocomplete="new-password" hidden>
    <div id="pwErr" class="lockerr"></div>
    <button id="pwGo" class="pairgo">OK</button>
  </div>
</div>
<div id="tipsOverlay" hidden>
  <div id="tipsModal" role="dialog" aria-label="Markdown tips">
    <div class="tipshead">
      <strong>Writing basics</strong>
      <button class="iconbtn" id="tipsClose" aria-label="Close">${icon("x")}</button>
    </div>
    <p class="tipsintro">Just type — formatting appears as you write. The raw marks only show on the line you're editing.</p>
    <table class="tipstable">
      <tr><td><code># Title</code></td><td>big heading (<code>##</code>, <code>###</code> = smaller)</td></tr>
      <tr><td><code>**bold**</code></td><td><strong>bold</strong></td></tr>
      <tr><td><code>*italic*</code></td><td><em>italic</em></td></tr>
      <tr><td><code>~~done~~</code></td><td><del>struck through</del></td></tr>
      <tr><td><code>- item</code></td><td>• bulleted list</td></tr>
      <tr><td><code>1. item</code></td><td>numbered list</td></tr>
      <tr><td><code>[[Note title]]</code></td><td>link to another note</td></tr>
      <tr><td><code>&gt; quote</code></td><td>quoted text</td></tr>
      <tr><td><code>\`code\`</code></td><td>inline <code>code</code></td></tr>
      <tr><td><code>---</code></td><td>divider line</td></tr>
    </table>
    <p class="tipsfoot">Tip: the box at the bottom of the list adds a timestamped line to today's daily note — the fastest way to capture a thought.</p>
  </div>
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
