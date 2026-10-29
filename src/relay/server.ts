/**
 * Node host for the relay (self-host + tests): node:http + better-sqlite3 +
 * `ws`, around the platform-neutral core in core.ts. Static assets (web app
 * bundle, icons, demo) are read from the built dist/ tree.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { WebSocketServer, WebSocket } from "ws";
import { createRelayCore, MAX_BODY, type SqlStore } from "./core.js";
import { openGeo, countryFromReader, clientIp } from "./geo.js";

export interface RelayOptions {
  port: number;
  dbPath?: string; // default in-memory
  /** per-account ciphertext cap in bytes; undefined/0 = unlimited (self-host default) */
  quotaBytes?: number;
  /** accountSignPub (hex) allowed to read /v1/admin/stats; unset = endpoint disabled */
  adminAccount?: string;
  /** 32-byte key encrypting hosted-MCP cloud-agent keys at rest */
  connectorKek?: Uint8Array;
}

/** better-sqlite3 binds Buffers, not bare Uint8Arrays. */
const bindable = (params: unknown[]) => params.map((p) => (p instanceof Uint8Array && !Buffer.isBuffer(p) ? Buffer.from(p) : p));

export function sqliteStore(db: Database.Database): SqlStore {
  const cache = new Map<string, Database.Statement>();
  const stmt = (q: string) => {
    let s = cache.get(q);
    if (!s) cache.set(q, (s = db.prepare(q)));
    return s;
  };
  return {
    all: <T>(q: string, ...p: unknown[]) => {
      const s = stmt(q);
      if (s.reader) return s.all(...bindable(p)) as T[];
      s.run(...bindable(p));
      return [];
    },
    run: (q: string, ...p: unknown[]) => void stmt(q).run(...bindable(p)),
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const STATIC: Record<string, { candidates: string[]; type: string; cache: string }> = {
  "/demo.svg": {
    candidates: [path.join(here, "../assets/demo.svg"), path.join(here, "../../assets/demo.svg"), path.join(process.cwd(), "assets/demo.svg")],
    type: "image/svg+xml; charset=utf-8",
    cache: "public, max-age=3600",
  },
  "/app/bundle.js": {
    candidates: [
      path.join(here, "../webapp/bundle.js"), // dist/relay → dist/webapp
      path.join(process.cwd(), "dist/webapp/bundle.js"), // test builds
    ],
    type: "text/javascript; charset=utf-8",
    cache: "no-cache",
  },
};
for (const name of ["icon-192.png", "icon-512.png", "icon-180.png", "icon-maskable-512.png"]) {
  STATIC[`/app/${name}`] = {
    candidates: [path.join(here, "../assets/icons", name), path.join(here, "../../assets/icons", name), path.join(process.cwd(), "assets/icons", name)],
    type: "image/png",
    cache: "public, max-age=604800",
  };
}

function serveStatic(pathname: string, res: http.ServerResponse): boolean {
  const entry = STATIC[pathname];
  if (!entry) return false;
  const f = entry.candidates.find((p) => fs.existsSync(p));
  if (!f) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `${pathname} not built (npm run build)` }));
    return true;
  }
  res.writeHead(200, { "Content-Type": entry.type, "Cache-Control": entry.cache });
  res.end(fs.readFileSync(f));
  return true;
}

export async function startRelay(
  opts: RelayOptions
): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  if (opts.dbPath) fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
  const db = new Database(opts.dbPath ?? ":memory:");
  db.pragma("journal_mode = WAL");
  const geo = await openGeo();
  const core = createRelayCore({
    sql: sqliteStore(db),
    quotaBytes: opts.quotaBytes,
    adminAccount: opts.adminAccount,
    connectorKek: opts.connectorKek,
    broadcast: (spaceId, seq, exceptDevice) => broadcastChange(spaceId, seq, exceptDevice),
  });

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && serveStatic(new URL(req.url ?? "/", "http://relay").pathname, res)) return;
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => void forward(req, res, Buffer.concat(chunks)).catch((err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }));
  });

  async function forward(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer): Promise<void> {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(new URL(req.url ?? "/", "http://relay"), { method: req.method, headers, body: hasBody ? new Uint8Array(body) : undefined });
    const response = await core.handle(request, {
      country: () => countryFromReader(geo, clientIp(req.headers, req.socket?.remoteAddress)),
    });
    const out: Record<string, string> = {};
    response.headers.forEach((v, k) => (out[k] = v));
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  // ---- live sync: WebSocket wake-up channel on /ws (auth lives in core.verifySub) ----
  const subs = new Map<string, Set<WebSocket>>(); // spaceId → live sockets
  const unsubscribeAll = (ws: WebSocket) => {
    for (const set of subs.values()) set.delete(ws);
  };
  function broadcastChange(spaceId: string, seq: number, exceptDevice: string): void {
    const set = subs.get(spaceId);
    if (!set) return;
    const msg = JSON.stringify({ type: "changed", space: spaceId, seq });
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN && (ws as WSMeta).vnDevice !== exceptDevice) ws.send(msg);
    }
  }

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws: WebSocket) => {
    const meta = ws as WSMeta;
    meta.vnAlive = true;
    ws.on("pong", () => (meta.vnAlive = true));
    ws.on("message", (raw: Buffer) => {
      const result = core.verifySub(raw.toString());
      if (!result) return;
      if ("error" in result) return ws.send(JSON.stringify({ type: "error", error: result.error }));
      meta.vnDevice = result.device;
      unsubscribeAll(ws);
      for (const spaceId of result.spaces) {
        let set = subs.get(spaceId);
        if (!set) subs.set(spaceId, (set = new Set()));
        set.add(ws);
      }
      ws.send(JSON.stringify({ type: "subscribed", spaces: result.spaces }));
    });
    ws.on("close", () => unsubscribeAll(ws));
    ws.on("error", () => unsubscribeAll(ws));
  });
  // Drop half-open sockets so subs stay clean.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const meta = ws as WSMeta;
      if (meta.vnAlive === false) {
        ws.terminate();
        continue;
      }
      meta.vnAlive = false;
      ws.ping();
    }
  }, 30_000);
  (heartbeat as unknown as { unref?: () => void }).unref?.();

  await new Promise<void>((resolve) => server.listen(opts.port, resolve));
  const port = (server.address() as { port: number }).port;
  const close = async () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  };
  return { server, port, close };
}

interface WSMeta extends WebSocket {
  vnAlive?: boolean;
  vnDevice?: string;
}
