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
