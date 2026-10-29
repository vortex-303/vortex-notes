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
 *
 * This module is platform-neutral (Fetch Request/Response + a synchronous SQL
 * interface): server.ts runs it on Node + better-sqlite3, deploy/cf runs it in
 * a Cloudflare Durable Object on its SQLite storage.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { verify, fromHex, toHex, utf8, toB64, fromB64, openBox, encryptPayload, decryptPayload, signKeypairFromSeed, boxKeypairFromSeed } from "../crypto.js";
import { verifyDeviceCert, verifyAgentChain, type DeviceCertPayload, type SignedCert } from "../account.js";
import { landingShell } from "./landing.js";
import { renderPublicPage, type PublicTheme } from "./publicpage.js";
import { appShell } from "./appshell.js";
import { marked } from "marked";
import { createHostedMcp } from "./hostedmcp.js";

export const MAX_BODY = 8 * 1024 * 1024;
const MAX_SKEW_MS = 5 * 60 * 1000;
const PAIR_TTL_MS = 15 * 60 * 1000;

// PWA service worker: makes the app launch offline. It caches ONLY the static
// shell (HTML/JS/manifest/icons) — never /v1/* API traffic, so no ciphertext or
// signed responses are ever stored. Network-first for the shell so updates land
// the moment you're online; cache is the offline fallback.
const SW_CACHE = "vortex-notes-v2";
const SERVICE_WORKER = `
const CACHE = ${JSON.stringify(SW_CACHE)};
const SHELL = ["/app", "/app/bundle.js", "/app/manifest.webmanifest",
  "/app/icon-192.png", "/app/icon-512.png", "/app/icon-180.png", "/app/icon-maskable-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;                 // never touch writes
  if (url.origin !== self.location.origin) return;        // relay same-origin only
  if (url.pathname.startsWith("/v1/")) return;            // API: always live, never cached
  const isShell = url.pathname === "/app" || url.pathname === "/app/bundle.js" || url.pathname === "/app/manifest.webmanifest";
  if (isShell) {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  if (url.pathname.startsWith("/app/icon")) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
`.trim();

/** Synchronous SQLite surface shared by better-sqlite3 and Durable Object storage. */
export interface SqlStore {
  /** Rows of a query (also INSERT/UPDATE/DELETE … RETURNING). */
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[];
  /** One statement, no result rows. */
  run(sql: string, ...params: unknown[]): void;
}

export interface RelayCoreOptions {
  sql: SqlStore;
  /** per-account ciphertext cap in bytes; undefined/0 = unlimited (self-host default) */
  quotaBytes?: number;
  /** comma-separated accountSignPubs (hex) allowed on /v1/admin/*; unset = disabled */
  adminAccount?: string;
  /**
   * Optional 32-byte key that encrypts cloud-agent private keys at rest
   * (hosted MCP connectors). Without it they're stored as-is (self-host).
   */
  connectorKek?: Uint8Array;
  /** Wake live subscribers of a space (WebSocket layer is per-platform). */
  broadcast?: (spaceId: string, seq: number, exceptDevice: string) => void;
}

export interface RequestContext {
  /** Coarse 2-letter country of the caller, derived in memory; null if unknown. */
  country?: () => string | null;
}

export interface RelayCore {
  handle(req: Request, ctx?: RequestContext): Promise<Response>;
  /** Check a WebSocket "sub" frame; returns the device + spaces it may hear about. */
  verifySub(raw: string): { device: string; spaces: string[] } | { error: string } | null;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (
    signPub TEXT PRIMARY KEY,
    encPub TEXT NOT NULL,
    account TEXT NOT NULL,
    cert TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    sealedKeys TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS updates (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    space TEXT NOT NULL,
    doc TEXT NOT NULL,
    author TEXT NOT NULL,
    blob BLOB NOT NULL,
    ts TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS updates_space_seq ON updates(space, seq)`,
  `CREATE TABLE IF NOT EXISTS accounts (
    account TEXT PRIMARY KEY,
    bytesUsed INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS public_notes (
    slug TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    theme TEXT NOT NULL DEFAULT 'manuscript',
    md TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS public_account_path ON public_notes(account, path)`,
  `CREATE TABLE IF NOT EXISTS pair_requests (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    signPub TEXT NOT NULL,
    encPub TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    approvedBlob TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS connectors (
    token TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    agentSignPub TEXT NOT NULL,
    keys TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    lastUsedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS admin_tags (
    account TEXT PRIMARY KEY,
    tag TEXT NOT NULL,
    taggedAt TEXT NOT NULL
  )`,
];

/** Create tables, run migrations, backfill usage. Idempotent. */
export function migrate(sql: SqlStore): void {
  for (const s of SCHEMA) sql.run(s);
  // Migration: coarse country per device (only a 2-letter code is ever stored).
  try {
    sql.all("SELECT country FROM devices LIMIT 0");
  } catch {
    sql.run("ALTER TABLE devices ADD COLUMN country TEXT");
  }
  // Backfill usage counters for accounts created before quotas existed.
  sql.run(
    "INSERT OR REPLACE INTO accounts (account, bytesUsed) " +
      "SELECT s.account, COALESCE(SUM(LENGTH(u.blob)), 0) " +
      "FROM spaces s LEFT JOIN updates u ON u.space = s.id GROUP BY s.account"
  );
}

const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const asBytes = (b: unknown): Uint8Array => (b instanceof Uint8Array ? b : new Uint8Array(b as ArrayBuffer));

export function createRelayCore(opts: RelayCoreOptions): RelayCore {
  const db = opts.sql;
  migrate(db);
  const get = <T>(q: string, ...p: unknown[]): T | undefined => db.all<T>(q, ...p)[0];
  const quota = opts.quotaBytes && opts.quotaBytes > 0 ? opts.quotaBytes : null;
  const usageOf = (account: string): number =>
    get<{ bytesUsed: number }>("SELECT bytesUsed FROM accounts WHERE account=?", account)?.bytesUsed ?? 0;
  const addUsage = (account: string, delta: number) =>
    db.run(
      "INSERT INTO accounts (account, bytesUsed) VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET bytesUsed = bytesUsed + excluded.bytesUsed",
      account,
      delta
    );

  /** The one write path for ciphertext: quota-checked against the space OWNER, then broadcast. */
  const appendUpdate = (spaceId: string, ownerAccount: string, doc: string, author: string, blob: Uint8Array): number | { error: string } => {
    if (quota && usageOf(ownerAccount) + blob.length > quota) {
      return { error: "Storage quota exceeded (" + Math.round(quota / 1e6) + "MB). Delete notes or upgrade." };
    }
    const seq = Number(
      get<{ seq: number }>(
        "INSERT INTO updates (space, doc, author, blob, ts) VALUES (?, ?, ?, ?, ?) RETURNING seq",
        spaceId, doc, author, blob, new Date().toISOString()
      )!.seq
    );
    addUsage(ownerAccount, blob.length);
    // Wake every OTHER live subscriber of this space — a poke, not the data;
    // they pull the ciphertext over signed HTTP exactly as before.
    opts.broadcast?.(spaceId, seq, author);
    return seq;
  };

  // ---- hosted MCP connectors (cloud agents) ----
  const kekAad = (token: string) => `vortex-connector-v1:${token}`;
  const sealKeys = (token: string, keys: Uint8Array): string =>
    opts.connectorKek ? "k1:" + toB64(encryptPayload(opts.connectorKek, keys, kekAad(token))) : "p1:" + toB64(keys);
  const openKeys = (token: string, stored: string): Uint8Array => {
    if (stored.startsWith("p1:")) return fromB64(stored.slice(3));
    if (!opts.connectorKek) throw new Error("Connector keys are encrypted but no key is configured");
    return decryptPayload(opts.connectorKek, fromB64(stored.slice(3)), kekAad(token));
  };
  let hostedAuthor = "";
  let hostedOwner = "";
  const hosted = createHostedMcp({
    pull: (spaceId, since) =>
      db.all<{ seq: number; doc: string; blob: unknown }>("SELECT seq, doc, blob FROM updates WHERE space=? AND seq>? ORDER BY seq", spaceId, since)
        .map((r) => ({ seq: r.seq, doc: r.doc, blob: asBytes(r.blob) })),
    push: (spaceId, doc, blob) => {
      const r = appendUpdate(spaceId, hostedOwner, doc, hostedAuthor, blob);
      if (typeof r !== "number") throw new Error(r.error);
      return r;
    },
  });

  function handleMcp(req: Request, token: string, body: Uint8Array): Response {
    const conn = get<{ token: string; agentSignPub: string; keys: string }>("SELECT token, agentSignPub, keys FROM connectors WHERE token=?", token);
    const agent = conn && get<{ account: string; cert: string }>("SELECT account, cert FROM devices WHERE signPub=?", conn.agentSignPub);
    if (!conn || !agent) return json(404, { error: "Unknown or revoked connector" });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST (stateless Streamable HTTP MCP)" }), {
        status: 405,
        headers: { Allow: "POST", "Content-Type": "application/json" },
      });
    }
    const cert = JSON.parse(agent.cert) as SignedCert;
    const keys = openKeys(token, conn.keys);
    const box = boxKeypairFromSeed(keys.slice(32, 64));
    const spaceId = cert.spaces?.[0];
    const space = spaceId ? get<{ account: string; sealedKeys: string }>("SELECT account, sealedKeys FROM spaces WHERE id=?", spaceId) : undefined;
    const sealed = space ? (JSON.parse(space.sealedKeys) as Record<string, string>)[conn.agentSignPub] : undefined;
    if (!space || !sealed) return json(404, { error: "This connector's space is no longer shared with it" });
    hostedAuthor = conn.agentSignPub;
    hostedOwner = space.account;
    const sess = { spaceId: spaceId!, spaceKey: openBox(fromHex(sealed), box), readOnly: cert.mode === "ro" };
    db.run("UPDATE connectors SET lastUsedAt=? WHERE token=?", new Date().toISOString(), token);

    let msg: unknown;
    try {
      msg = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    const out = Array.isArray(msg)
      ? msg.map((m) => hosted.rpc(sess, m as Record<string, unknown>)).filter(Boolean)
      : hosted.rpc(sess, msg as Record<string, unknown>);
    if (out === null || (Array.isArray(out) && !out.length)) return new Response(null, { status: 202 });
    return json(200, out);
  }

  const pruneAndGetPair = (code: string) => {
    db.run("DELETE FROM pair_requests WHERE createdAt < ?", Date.now() - PAIR_TTL_MS);
    return get<{ code: string; name: string; signPub: string; encPub: string; createdAt: number; approvedBlob: string | null }>(
      "SELECT * FROM pair_requests WHERE code=?",
      code
    );
  };

  async function handle(req: Request, ctx: RequestContext = {}): Promise<Response> {
    try {
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length > MAX_BODY) return json(413, { error: "Body too large" });
      return route(req, body, ctx);
    } catch (err) {
      return json(500, { error: (err as Error).message });
    }
  }

  function route(req: Request, body: Uint8Array, ctx: RequestContext): Response {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /health") return json(200, { ok: true });

    if (route === "GET /") {
      const nonce = toB64(randomBytes(16));
      return html(200, landingShell(nonce), {
        "Content-Security-Policy": "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; img-src 'self' data:",
      });
    }
    if (route === "GET /app") {
      const nonce = toB64(randomBytes(16));
      return html(200, appShell(nonce), {
        "Content-Security-Policy": `default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; manifest-src 'self'`,
        "Cache-Control": "no-cache",
      });
    }
    if (route === "GET /app/manifest.webmanifest") {
      return new Response(
        JSON.stringify({
          name: "Vortex Notes",
          short_name: "Vortex",
          description: "End-to-end encrypted notes — shared memory for you and your AI agents.",
          start_url: "/app",
          scope: "/app",
          display: "standalone",
          orientation: "portrait-primary",
          background_color: "#121715",
          theme_color: "#14735C",
          categories: ["productivity", "utilities"],
          icons: [
            { src: "/app/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/app/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/app/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        }),
        { headers: { "Content-Type": "application/manifest+json" } }
      );
    }
    if (route === "GET /sw.js") {
      // Root scope so the service worker also controls the /app entry itself.
      return new Response(SERVICE_WORKER, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Service-Worker-Allowed": "/",
          "Cache-Control": "no-cache",
        },
      });
    }

    const pubMatch = url.pathname.match(/^\/p\/([a-z0-9-]+)$/);
    if (req.method === "GET" && pubMatch) {
      const row = get<{ title: string; author: string | null; theme: string; md: string; updatedAt: string }>(
        "SELECT * FROM public_notes WHERE slug=?",
        pubMatch[1]
      );
      if (!row) {
        return html(404, "<h1 style='font-family:serif;text-align:center;margin-top:20vh'>This note is no longer public.</h1>");
      }
      // Render markdown; strip script tags belt-and-braces — the CSP below is
      // the real guarantee that published content can't execute anything.
      let bodyHtml = marked.parse(row.md, { async: false }) as string;
      bodyHtml = bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, "");
      return html(
        200,
        renderPublicPage({
          title: row.title,
          author: row.author,
          theme: row.theme as PublicTheme,
          bodyHtml,
          updatedAt: row.updatedAt,
        }),
        {
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src 'self'",
          "Cache-Control": "public, max-age=60",
        }
      );
    }

    const mcpMatch = url.pathname.match(/^\/mcp\/([0-9a-f]{64})$/);
    if (mcpMatch) return handleMcp(req, mcpMatch[1], body);

    if (route === "POST /v1/pair/request") {
      const b = parse(body);
      const name = String(b.name ?? "agent").slice(0, 60);
      const signPub = String(b.signPub ?? "");
      const encPub = String(b.encPub ?? "");
      if (!/^[0-9a-f]{64}$/.test(signPub) || !/^[0-9a-f]{64}$/.test(encPub)) {
        return json(400, { error: "signPub and encPub (32-byte hex) required" });
      }
      const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
      let code = "";
      for (const byte of randomBytes(6)) code += alphabet[byte % alphabet.length];
      db.run("DELETE FROM pair_requests WHERE createdAt < ?", Date.now() - PAIR_TTL_MS);
      db.run("INSERT INTO pair_requests (code, name, signPub, encPub, createdAt) VALUES (?, ?, ?, ?, ?)", code, name, signPub, encPub, Date.now());
      return json(200, { code, expiresInMs: PAIR_TTL_MS });
    }
    if (route === "GET /v1/pair/poll") {
      const code = url.searchParams.get("code") ?? "";
      const signPub = url.searchParams.get("signPub") ?? "";
      const row = pruneAndGetPair(code);
      if (!row) return json(404, { error: "Unknown or expired pairing code" });
      if (row.signPub !== signPub) return json(403, { error: "Not your pairing request" });
      if (!row.approvedBlob) return json(200, { status: "pending" });
      db.run("DELETE FROM pair_requests WHERE code=?", code);
      return json(200, { status: "approved", grant: row.approvedBlob });
    }

    if (route === "POST /v1/register") {
      const b = parse(body);
      const accountSignPub = String(b.accountSignPub ?? "");
      const accountEncPub = String(b.accountEncPub ?? "");
      const device = b.device as (DeviceCertPayload & { certSig: string }) | undefined;
      if (!accountSignPub || !accountEncPub || !device) {
        return json(400, { error: "accountSignPub, accountEncPub, device required" });
      }
      if (device.kind === "agent") {
        const chain = b.chain as SignedCert | undefined;
        if (!chain || !verifyAgentChain(fromHex(accountSignPub), device, chain)) {
          return json(401, { error: "Agent certificate chain is invalid" });
        }
      } else if (!verifyDeviceCert(fromHex(accountSignPub), device)) {
        return json(401, { error: "Device certificate not signed by that account" });
      }
      // Coarse country only, derived in memory; the IP is never stored or logged.
      const country = ctx.country?.() ?? null;
      db.run(
        `INSERT INTO devices (signPub, encPub, account, cert, createdAt, country) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(signPub) DO UPDATE SET cert=excluded.cert, country=COALESCE(devices.country, excluded.country)`,
        device.signPub,
        device.encPub,
        accountSignPub,
        JSON.stringify(device),
        new Date().toISOString(),
        country
      );
      return json(200, { ok: true });
    }

    // --- everything below requires a signed request from a registered device ---
    const auth = authenticate(req, url, body);
    if ("error" in auth) return json(401, { error: auth.error });
    const { account, devicePub } = auth;
    const isAgent = auth.cert?.kind === "agent";
    const scope = isAgent ? auth.cert?.spaces ?? [] : null; // agents: only certified spaces
    const readOnly = isAgent && auth.cert?.mode === "ro";
    const inScope = (spaceId: string) => scope === null || scope.includes(spaceId);

    if (route === "GET /v1/pair/pending") {
      if (isAgent) return json(403, { error: "Agents cannot approve pairings" });
      const code = url.searchParams.get("code") ?? "";
      const row = pruneAndGetPair(code);
      if (!row) return json(404, { error: "Unknown or expired pairing code" });
      return json(200, { code: row.code, name: row.name, signPub: row.signPub, encPub: row.encPub });
    }
    if (route === "POST /v1/pair/approve") {
      if (isAgent) return json(403, { error: "Agents cannot approve pairings" });
      const b = parse(body);
      const code = String(b.code ?? "");
      const grant = String(b.grant ?? "");
      const row = pruneAndGetPair(code);
      if (!row) return json(404, { error: "Unknown or expired pairing code" });
      if (!grant) return json(400, { error: "grant (base64) required" });
      db.run("UPDATE pair_requests SET approvedBlob=? WHERE code=?", grant, code);
      return json(200, { ok: true });
    }

    if (route === "PUT /v1/public") {
      if (isAgent) return json(403, { error: "Agents cannot publish notes" });
      const b = parse(body);
      const notePath = String(b.path ?? "");
      const title = String(b.title ?? "Untitled").slice(0, 200);
      const author = b.author ? String(b.author).slice(0, 80) : null;
      const theme = ["manuscript", "vortex", "typewriter"].includes(String(b.theme)) ? String(b.theme) : "manuscript";
      const md = String(b.markdown ?? "");
      if (!notePath || !md) return json(400, { error: "path and markdown required" });
      if (md.length > 500_000) return json(413, { error: "Note too large to publish" });
      const now = new Date().toISOString();
      const givenSlug = b.slug ? String(b.slug) : null;
      const row = givenSlug
        ? get<{ slug: string; account: string; md: string }>("SELECT slug, account, md FROM public_notes WHERE slug=?", givenSlug)
        : get<{ slug: string; account: string; md: string }>("SELECT slug, account, md FROM public_notes WHERE account=? AND path=?", account, notePath);
      if (row && row.account !== account) return json(403, { error: "Not your public note" });
      if (row) {
        if (quota && usageOf(account) + (md.length - row.md.length) > quota) {
          return json(413, { error: "Storage quota exceeded" });
        }
        db.run("UPDATE public_notes SET path=?, title=?, author=?, theme=?, md=?, updatedAt=? WHERE slug=?", notePath, title, author, theme, md, now, row.slug);
        addUsage(account, md.length - row.md.length);
        return json(200, { slug: row.slug });
      }
      if (quota && usageOf(account) + md.length > quota) {
        return json(413, { error: "Storage quota exceeded" });
      }
      const base = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "note";
      const alphabet = "abcdefghjkmnpqrstvwxyz23456789";
      let suffix = "";
      for (const byte of randomBytes(4)) suffix += alphabet[byte % alphabet.length];
      const slug = base + "-" + suffix;
      db.run(
        "INSERT INTO public_notes (slug, account, path, title, author, theme, md, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
        slug, account, notePath, title, author, theme, md, now, now
      );
      addUsage(account, md.length);
      return json(200, { slug });
    }
    const delPubMatch = url.pathname.match(/^\/v1\/public\/([a-z0-9-]+)$/);
    if (req.method === "DELETE" && delPubMatch) {
      if (isAgent) return json(403, { error: "Agents cannot unpublish notes" });
      const row = get<{ account: string; md: string }>("SELECT account, md FROM public_notes WHERE slug=?", delPubMatch[1]);
      if (!row) return json(404, { error: "No such public note" });
      if (row.account !== account) return json(403, { error: "Not your public note" });
      db.run("DELETE FROM public_notes WHERE slug=?", delPubMatch[1]);
      addUsage(account, -row.md.length);
      return json(200, { ok: true });
    }
    if (route === "GET /v1/public") {
      const rows = db.all("SELECT slug, path, title, author, theme, updatedAt FROM public_notes WHERE account=?", account);
      return json(200, { published: rows });
    }
    if (route === "POST /v1/connectors") {
      if (isAgent) return json(403, { error: "Agents cannot create connectors" });
      const b = parse(body);
      const agentSignPub = String(b.agentSignPub ?? "");
      let keys: Uint8Array;
      try {
        keys = fromB64(String(b.keys ?? ""));
      } catch {
        keys = new Uint8Array(0);
      }
      if (keys.length !== 64) return json(400, { error: "keys (64 bytes: sign seed ‖ box seed, base64) required" });
      const agent = get<{ account: string; cert: string }>("SELECT account, cert FROM devices WHERE signPub=?", agentSignPub);
      if (!agent || agent.account !== account) return json(404, { error: "Register the agent under your account first" });
      const cert = JSON.parse(agent.cert) as SignedCert;
      // The uploaded seeds must be THIS agent's keys, or we'd hold a key for someone else.
      if (cert.kind !== "agent" || toHex(signKeypairFromSeed(keys.slice(0, 32)).pub) !== agentSignPub || toHex(boxKeypairFromSeed(keys.slice(32, 64)).pub) !== cert.encPub) {
        return json(400, { error: "Keys don't match that agent" });
      }
      const token = toHex(randomBytes(32));
      db.run(
        "INSERT INTO connectors (token, account, agentSignPub, keys, createdAt) VALUES (?, ?, ?, ?, ?)",
        token, account, agentSignPub, sealKeys(token, keys), new Date().toISOString()
      );
      return json(200, { token, path: `/mcp/${token}` });
    }
    if (route === "GET /v1/connectors") {
      if (isAgent) return json(403, { error: "Agents cannot list connectors" });
      return json(200, {
        connectors: db.all("SELECT token, agentSignPub, createdAt, lastUsedAt FROM connectors WHERE account=? ORDER BY createdAt", account),
      });
    }
    if (route.includes(" /v1/admin/")) {
      const admins = (opts.adminAccount ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!admins.includes(account)) {
        return json(403, { error: "Not an admin account" });
      }
    }
    if (route === "GET /v1/admin/stats") {
      const n = (q: string, ...args: unknown[]) => get<{ n: number }>(q, ...args)?.n ?? 0;
      const dayAgo = new Date(Date.now() - 86400_000).toISOString();
      const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      return json(200, {
        accounts: n("SELECT COUNT(*) n FROM accounts"),
        devices: n("SELECT COUNT(*) n FROM devices WHERE cert NOT LIKE '%\"kind\":\"agent\"%'"),
        agents: n("SELECT COUNT(*) n FROM devices WHERE cert LIKE '%\"kind\":\"agent\"%'"),
        spaces: n("SELECT COUNT(*) n FROM spaces"),
        updatesTotal: n("SELECT COUNT(*) n FROM updates"),
        updates24h: n("SELECT COUNT(*) n FROM updates WHERE ts > ?", dayAgo),
        updates7d: n("SELECT COUNT(*) n FROM updates WHERE ts > ?", weekAgo),
        bytesStored: n("SELECT COALESCE(SUM(bytesUsed),0) n FROM accounts"),
        publicNotes: n("SELECT COUNT(*) n FROM public_notes"),
        pendingPairings: n("SELECT COUNT(*) n FROM pair_requests WHERE approvedBlob IS NULL"),
        newAccounts: n("SELECT COUNT(DISTINCT account) n FROM devices WHERE account NOT IN (SELECT account FROM admin_tags)"),
        byCountry: db.all("SELECT country, COUNT(DISTINCT account) n FROM devices WHERE country IS NOT NULL GROUP BY country ORDER BY n DESC, country"),
        topAccounts: db.all("SELECT substr(account,1,8) id, bytesUsed FROM accounts ORDER BY bytesUsed DESC LIMIT 5"),
      });
    }
    if (route === "GET /v1/admin/accounts") {
      const rows = db.all<{ account: string }>("SELECT DISTINCT account FROM devices ORDER BY rowid");
      const accounts = rows.map(({ account: acc }) => {
        const principals = db
          .all<{ signPub: string; cert: string; createdAt: string }>("SELECT signPub, cert, createdAt FROM devices WHERE account=? ORDER BY createdAt", acc)
          .map((r) => {
            const c = JSON.parse(r.cert) as { name?: string; kind?: string };
            return { name: c.name ?? "?", kind: c.kind ?? "device", createdAt: r.createdAt };
          });
        const act = get<{ firstTs: string | null; lastTs: string | null; n: number }>(
          "SELECT MIN(u.ts) firstTs, MAX(u.ts) lastTs, COUNT(*) n FROM updates u JOIN devices d ON u.author=d.signPub WHERE d.account=?",
          acc
        );
        return {
          account: acc,
          firstSeen: principals[0]?.createdAt ?? null,
          lastActive: act?.lastTs ?? null,
          updates: act?.n ?? 0,
          bytesUsed: usageOf(acc),
          principals,
          publicTitles: db.all<{ title: string }>("SELECT title FROM public_notes WHERE account=?", acc).map((r) => r.title),
          tag: get<{ tag: string }>("SELECT tag FROM admin_tags WHERE account=?", acc)?.tag ?? null,
          country: get<{ country: string }>("SELECT country FROM devices WHERE account=? AND country IS NOT NULL LIMIT 1", acc)?.country ?? null,
        };
      });
      return json(200, { accounts });
    }
    if (route === "PUT /v1/admin/tag") {
      const { account: target, tag } = parse(body) as { account?: string; tag?: string };
      if (!target) return json(400, { error: "account required" });
      if (!tag) db.run("DELETE FROM admin_tags WHERE account=?", target);
      else
        db.run(
          "INSERT INTO admin_tags (account, tag, taggedAt) VALUES (?, ?, ?) ON CONFLICT(account) DO UPDATE SET tag=excluded.tag, taggedAt=excluded.taggedAt",
          target, tag, new Date().toISOString()
        );
      return json(200, { ok: true });
    }
    if (route === "GET /v1/usage") {
      return json(200, { bytesUsed: usageOf(account), quotaBytes: quota });
    }
    if (route === "GET /v1/principals") {
      const rows = db.all<{ signPub: string; cert: string; createdAt: string }>("SELECT signPub, cert, createdAt FROM devices WHERE account=?", account);
      return json(200, {
        principals: rows.map((r) => {
          const c = JSON.parse(r.cert) as SignedCert;
          return { signPub: r.signPub, name: c.name, kind: c.kind ?? "device", spaces: c.spaces, mode: c.mode, registeredAt: r.createdAt };
        }),
      });
    }
    const principalMatch = url.pathname.match(/^\/v1\/principals\/([0-9a-f]+)$/);
    if (req.method === "DELETE" && principalMatch) {
      if (isAgent) return json(403, { error: "Agents cannot revoke principals" });
      const gone = db.all("DELETE FROM devices WHERE signPub=? AND account=? RETURNING signPub", principalMatch[1], account);
      if (gone.length) db.run("DELETE FROM connectors WHERE agentSignPub=?", principalMatch[1]); // kills its MCP URL + held keys
      return json(gone.length ? 200 : 404, gone.length ? { ok: true } : { error: "No such principal" });
    }

    const rawMatch = url.pathname.match(/^\/v1\/spaces\/([a-z0-9-]+)(?:\/docs\/([A-Za-z0-9._%-]+))?$/);
    const spaceMatch = rawMatch
      ? ([rawMatch[0], rawMatch[1], rawMatch[2] ? decodeURIComponent(rawMatch[2]) : undefined] as const)
      : null;

    // Membership: a principal can see/use a space if their account owns it OR
    // their device/account key appears in sealedKeys — the seals ARE the ACL.
    const isMember = (row: { account: string; sealedKeys: string }): boolean => spaceMemberOf(row, account, devicePub);

    if (route === "GET /v1/spaces") {
      const rows = db.all<{ id: string; account: string; sealedKeys: string; createdAt: string }>(
        "SELECT id, account, sealedKeys, createdAt FROM spaces"
      );
      return json(200, {
        spaces: rows
          .filter((r) => isMember(r) && inScope(r.id))
          .map((r) => ({ id: r.id, sealedKeys: JSON.parse(r.sealedKeys), createdAt: r.createdAt })),
      });
    }

    const transferMatch = url.pathname.match(/^\/v1\/spaces\/([^/]+)\/transfer$/);
    if (req.method === "POST" && transferMatch) {
      if (isAgent) return json(403, { error: "Agents cannot transfer spaces" });
      const id = transferMatch[1];
      const toAccount = String(parse(body).toAccount ?? "");
      if (!/^[0-9a-f]{64}$/.test(toAccount)) return json(400, { error: "toAccount (hex account key) required" });
      const sp = get<{ account: string }>("SELECT account FROM spaces WHERE id=?", id);
      if (!sp) return json(404, { error: `Unknown space ${id}` });
      if (sp.account !== account) return json(403, { error: "Not your space" });
      const target = get<{ n: number }>("SELECT COUNT(*) n FROM devices WHERE account=?", toAccount);
      if (!target?.n) return json(400, { error: "Target account has no registered devices" });
      db.run("UPDATE spaces SET account=? WHERE id=?", toAccount, id);
      db.run("UPDATE public_notes SET account=? WHERE account=?", toAccount, account);
      const usage = usageOf(account);
      if (usage) {
        addUsage(toAccount, usage);
        db.run("UPDATE accounts SET bytesUsed=0 WHERE account=?", account);
      }
      return json(200, { ok: true });
    }

    if (req.method === "PUT" && spaceMatch && !spaceMatch[2]) {
      if (isAgent) return json(403, { error: "Agents cannot modify space membership" });
      const id = spaceMatch[1];
      const b = parse(body);
      const sealedKeys = b.sealedKeys as Record<string, string> | undefined;
      if (!sealedKeys || typeof sealedKeys !== "object") return json(400, { error: "sealedKeys required" });
      const existing = get<{ account: string }>("SELECT account FROM spaces WHERE id=?", id);
      if (existing && existing.account !== account) return json(403, { error: "Not your space" });
      db.run(
        `INSERT INTO spaces (id, account, sealedKeys, createdAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET sealedKeys=excluded.sealedKeys`,
        id, account, JSON.stringify(sealedKeys), new Date().toISOString()
      );
      return json(200, { ok: true });
    }

    if (spaceMatch) {
      const spaceId = spaceMatch[1];
      const owner = get<{ account: string; sealedKeys: string }>("SELECT account, sealedKeys FROM spaces WHERE id=?", spaceId);
      if (!owner) return json(404, { error: `Unknown space ${spaceId}` });
      if (!isMember(owner)) return json(403, { error: "Not your space" });
      if (!inScope(spaceId)) return json(403, { error: "This agent is not granted that space" });

      if (req.method === "POST" && spaceMatch[2]) {
        if (readOnly) return json(403, { error: "This agent is read-only" });
        const b = parse(body);
        let blob: Uint8Array;
        try {
          blob = fromB64(String(b.blob ?? ""));
        } catch {
          blob = new Uint8Array(0);
        }
        if (!blob.length) return json(400, { error: "blob (base64) required" });
        // Quota is per space OWNER — members' pushes count against the owner.
        const seq = appendUpdate(spaceId, owner.account, spaceMatch[2], devicePub, blob);
        if (typeof seq !== "number") return json(413, seq);
        return json(200, { seq });
      }

      if (req.method === "GET" && !spaceMatch[2]) {
        const since = Number(url.searchParams.get("since") ?? 0);
        const doc = url.searchParams.get("doc");
        const rows = doc
          ? db.all<{ seq: number; doc: string; author: string; blob: unknown; ts: string }>(
              "SELECT seq, doc, author, blob, ts FROM updates WHERE space=? AND doc=? AND seq>? ORDER BY seq LIMIT 500", spaceId, doc, since)
          : db.all<{ seq: number; doc: string; author: string; blob: unknown; ts: string }>(
              "SELECT seq, doc, author, blob, ts FROM updates WHERE space=? AND seq>? ORDER BY seq LIMIT 500", spaceId, since);
        return json(200, {
          updates: rows.map((r) => ({ seq: r.seq, doc: r.doc, author: r.author, ts: r.ts, blob: toB64(asBytes(r.blob)) })),
        });
      }
    }

    return json(404, { error: `No route: ${route}` });
  }

  function authenticate(req: Request, url: URL, body: Uint8Array): { account: string; devicePub: string; cert: SignedCert | null } | { error: string } {
    const devicePub = req.headers.get("x-vortex-device") ?? "";
    const ts = req.headers.get("x-vortex-ts") ?? "";
    const sig = req.headers.get("x-vortex-sig") ?? "";
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
    const row = get<{ account: string; cert: string }>("SELECT account, cert FROM devices WHERE signPub=?", devicePub);
    if (!row) return { error: "Device not registered" };
    let cert: SignedCert | null = null;
    try {
      cert = JSON.parse(row.cert) as SignedCert;
    } catch { /* legacy rows */ }
    return { account: row.account, devicePub, cert };
  }

  // ---- live sync: WebSocket wake-up channel on /ws ----
  // The socket never carries ciphertext or keys — only "space X changed" pokes.
  // A connection must prove membership (signed frame) before it is subscribed,
  // and only ever hears about spaces it already can read.
  function verifySub(raw: string): { device: string; spaces: string[] } | { error: string } | null {
    let frame: { type?: string; device?: string; ts?: string; sig?: string; spaces?: string[] };
    try {
      frame = JSON.parse(raw);
    } catch {
      return null;
    }
    if (frame.type !== "sub") return null;
    const { device = "", ts = "", sig = "", spaces = [] } = frame;
    // Signature over the requested space set proves this device asked for it.
    if (!device || !ts || Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) return { error: "bad-auth" };
    const canonical = `WS-SUB\n${ts}\n${toHex(sha256(utf8([...spaces].sort().join(","))))}`;
    let sigOk = false;
    try {
      sigOk = verify(fromHex(sig), utf8(canonical), fromHex(device));
    } catch {
      sigOk = false;
    }
    if (!sigOk) return { error: "bad-sig" };
    const dev = get<{ account: string }>("SELECT account FROM devices WHERE signPub=?", device);
    if (!dev) return { error: "unknown-device" };
    const granted: string[] = [];
    for (const spaceId of spaces) {
      const row = get<{ account: string; sealedKeys: string }>("SELECT account, sealedKeys FROM spaces WHERE id=?", spaceId);
      if (row && spaceMemberOf(row, dev.account, device)) granted.push(spaceId);
    }
    return { device, spaces: granted };
  }

  return { handle, verifySub };
}

function spaceMemberOf(row: { account: string; sealedKeys: string }, account: string, devicePub: string): boolean {
  if (row.account === account) return true;
  try {
    const sk = JSON.parse(row.sealedKeys) as Record<string, string>;
    return devicePub in sk || account in sk;
  } catch {
    return false;
  }
}

function parse(body: Uint8Array): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(body) || "{}");
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function html(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
}
