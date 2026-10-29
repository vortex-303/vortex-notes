/**
 * Cloudflare host for the relay: one SQLite-backed Durable Object ("main")
 * runs the same platform-neutral core as the Node relay. Edge entries (this
 * Worker's fetch, and the Pages _worker in pages.ts) only add the coarse
 * country from request.cf and forward to that single instance.
 *
 * The /ws wake-up channel uses hibernatable WebSockets: idle sockets cost
 * nothing, and each socket's subscription lives in its attachment.
 */
import { DurableObject } from "cloudflare:workers";
import { createRelayCore, type RelayCore, type SqlStore } from "../../src/relay/core.js";
import { fromHex } from "../../src/crypto.js";
import { toRelay, STATIC_PATHS, type Env } from "./edge.js";

export type { Env };


interface Sub {
  device: string;
  spaces: string[];
}

/** DO SQL binds ArrayBuffers, not Uint8Array views. */
const bindable = (params: unknown[]) =>
  params.map((p) => (p instanceof Uint8Array ? p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength) : p));

export class Relay extends DurableObject<Env> {
  private core: RelayCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    const store: SqlStore = {
      all: <T>(q: string, ...p: unknown[]) => sql.exec(q, ...bindable(p)).toArray() as T[],
      run: (q: string, ...p: unknown[]) => void sql.exec(q, ...bindable(p)),
    };
    const quotaMb = Number(env.RELAY_QUOTA_MB ?? 0);
    this.core = createRelayCore({
      sql: store,
      quotaBytes: quotaMb > 0 ? quotaMb * 1e6 : undefined,
      adminAccount: env.RELAY_ADMIN_ACCOUNT || undefined,
      connectorKek: env.RELAY_CONNECTOR_KEK ? fromHex(env.RELAY_CONNECTOR_KEK) : undefined,
      openaiAppsChallenge: env.OPENAI_APPS_CHALLENGE || undefined,
      broadcast: (spaceId, seq, exceptDevice) => {
        const msg = JSON.stringify({ type: "changed", space: spaceId, seq });
        for (const ws of ctx.getWebSockets()) {
          const sub = ws.deserializeAttachment() as Sub | null;
          if (!sub || sub.device === exceptDevice || !sub.spaces.includes(spaceId)) continue;
          try {
            ws.send(msg);
          } catch { /* closing */ }
        }
      },
    });
  }

  async fetch(req: Request): Promise<Response> {
    if (new URL(req.url).pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket upgrade", { status: 426 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    const country = req.headers.get("x-vn-country");
    return this.core.handle(req, { country: () => (country && /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : null) });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const result = this.core.verifySub(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    if (!result) return;
    if ("error" in result) return ws.send(JSON.stringify({ type: "error", error: result.error }));
    ws.serializeAttachment({ device: result.device, spaces: result.spaces } satisfies Sub);
    ws.send(JSON.stringify({ type: "subscribed", spaces: result.spaces }));
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code);
    } catch { /* already closed */ }
  }
}

// This Worker has no public URL in production (workers_dev = false); the Pages
// project is the front door. Locally (`wrangler dev`) it serves the whole app.
export default {
  fetch(req: Request, env: Env): Promise<Response> {
    if (env.ASSETS && req.method === "GET" && STATIC_PATHS.has(new URL(req.url).pathname)) return env.ASSETS.fetch(req);
    return toRelay(req, env);
  },
};
