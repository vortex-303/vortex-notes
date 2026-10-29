/**
 * OAuth 2.1 for hosted MCP connectors, so chat apps can connect to one URL
 * (`/mcp`) with a "Sign in → Approve" flow instead of a pasted secret URL.
 *
 * The relay is its own authorization server (no third party). Approval happens
 * in the web app: the signed-in browser creates a connector exactly as
 * "Connect a chat app" does, then trades it for a one-time code. Tokens map to
 * that connector, so revoking it in Agents & devices kills them.
 *
 * Rules kept deliberately strict: PKCE S256 only, exact redirect_uri match,
 * single-use codes that live 2 minutes, tokens stored as SHA-256 hashes,
 * refresh tokens rotate on every use.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { toHex, utf8 } from "../crypto.js";
import type { SqlStore } from "./core.js";

export const OAUTH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS oauth_clients (
    clientId TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    redirectUris TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_requests (
    id TEXT PRIMARY KEY,
    clientId TEXT NOT NULL,
    redirectUri TEXT NOT NULL,
    challenge TEXT NOT NULL,
    state TEXT,
    createdAt INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_codes (
    hash TEXT PRIMARY KEY,
    clientId TEXT NOT NULL,
    redirectUri TEXT NOT NULL,
    challenge TEXT NOT NULL,
    connector TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_tokens (
    hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    clientId TEXT NOT NULL,
    connector TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
  )`,
];

const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

const rand = (n: number) => toHex(crypto.getRandomValues(new Uint8Array(n)));
const hash = (s: string) => toHex(sha256(utf8(s)));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Public origin of this relay (behind a proxy, the forwarded host wins). */
export function publicOrigin(req: Request, url: URL): string {
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** https anywhere, or plain http only for a loopback address (desktop/CLI clients). */
function okRedirect(u: string): boolean {
  try {
    const p = new URL(u);
    if (p.hash) return false;
    if (p.protocol === "https:") return true;
    return p.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(p.hostname);
  } catch {
    return false;
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
export const corsHeaders = CORS;

function json(status: number, data: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra },
  });
}

function formOrJson(req: Request, body: Uint8Array): Record<string, string> {
  const text = new TextDecoder().decode(body);
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function errorPage(msg: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Can't connect</title>` +
      `<body style="font:16px/1.5 system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1 style="font-size:1.3rem">This app can't connect</h1><p>${msg.replace(/</g, "&lt;")}</p></body>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export interface OAuth {
  /** Handles discovery, /oauth/* and /v1/oauth/request/*; null if the path isn't ours. */
  route(req: Request, url: URL, body: Uint8Array): Response | null;
  /** Signed web-app call after the user approved: bind a fresh connector to a request. */
  approve(requestId: string, connectorToken: string, account: string): Response;
  /** Bearer token on /mcp → its connector token, or a 401 response. */
  bearer(req: Request, url: URL): { connector: string } | Response;
  /** A connector was deleted: drop everything that pointed at it. */
  forgetConnector(token: string): void;
}

export function createOAuth(db: SqlStore): OAuth {
  for (const s of OAUTH_SCHEMA) db.run(s);
  const get = <T>(q: string, ...p: unknown[]): T | undefined => db.all<T>(q, ...p)[0];
  const prune = () => {
    const now = Date.now();
    db.run("DELETE FROM oauth_requests WHERE createdAt < ?", now - REQUEST_TTL_MS);
    db.run("DELETE FROM oauth_codes WHERE createdAt < ?", now - CODE_TTL_MS);
    db.run("DELETE FROM oauth_tokens WHERE expiresAt < ?", now);
    // Registrations that never led to a sign-in don't linger (registration is open).
    db.run(
      "DELETE FROM oauth_clients WHERE createdAt < ? AND clientId NOT IN (SELECT clientId FROM oauth_tokens) " +
        "AND clientId NOT IN (SELECT clientId FROM oauth_codes) AND clientId NOT IN (SELECT clientId FROM oauth_requests)",
      new Date(now - 24 * 3600 * 1000).toISOString()
    );
  };

  const issueTokens = (clientId: string, connector: string) => {
    const access = rand(32);
    const refresh = rand(32);
    db.run("INSERT INTO oauth_tokens (hash, kind, clientId, connector, expiresAt) VALUES (?, 'access', ?, ?, ?)", hash(access), clientId, connector, Date.now() + ACCESS_TTL_S * 1000);
    db.run("INSERT INTO oauth_tokens (hash, kind, clientId, connector, expiresAt) VALUES (?, 'refresh', ?, ?, ?)", hash(refresh), clientId, connector, Date.now() + REFRESH_TTL_MS);
    return json(200, { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh });
  };
  const connectorAlive = (token: string) => !!get("SELECT 1 FROM connectors WHERE token=?", token);

  function route(req: Request, url: URL, body: Uint8Array): Response | null {
    const p = url.pathname;
    const origin = publicOrigin(req, url);
    const isOurs = p.startsWith("/.well-known/oauth-") || p.startsWith("/oauth/") || p.startsWith("/v1/oauth/request/");
    if (!isOurs) return null;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // RFC 9728 protected-resource metadata (root and the path-suffixed form for /mcp).
    if (req.method === "GET" && (p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp")) {
      return json(200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        bearer_methods_supported: ["header"],
        resource_name: "Vortex Notes",
      });
    }
    // RFC 8414 authorization-server metadata.
    if (req.method === "GET" && p === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }

    // RFC 7591 dynamic client registration (public clients only).
    if (req.method === "POST" && p === "/oauth/register") {
      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
      } catch {
        return json(400, { error: "invalid_client_metadata", error_description: "JSON body required" });
      }
      const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris.map(String) : [];
      if (!uris.length || uris.length > 10 || !uris.every(okRedirect)) {
        return json(400, { error: "invalid_redirect_uri", error_description: "redirect_uris must be https (or http on localhost)" });
      }
      const name = String(meta.client_name ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60) || "Chat app";
      const clientId = "vnc_" + rand(16);
      db.run("INSERT INTO oauth_clients (clientId, name, redirectUris, createdAt) VALUES (?, ?, ?, ?)", clientId, name, JSON.stringify(uris), new Date().toISOString());
      return json(201, {
        client_id: clientId,
        client_name: name,
        redirect_uris: uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    }

    // Start of the browser flow: validate, park the request, hand over to the web app.
    if (req.method === "GET" && p === "/oauth/authorize") {
      prune();
      const q = url.searchParams;
      const client = get<{ name: string; redirectUris: string }>("SELECT name, redirectUris FROM oauth_clients WHERE clientId=?", q.get("client_id") ?? "");
      if (!client) return errorPage("Unknown app. Try removing the connector and adding it again.");
      const redirectUri = q.get("redirect_uri") ?? "";
      if (!(JSON.parse(client.redirectUris) as string[]).includes(redirectUri)) return errorPage("The app's return address doesn't match what it registered.");
      // From here on, errors go back to the app (its redirect is verified).
      const back = (error: string) => {
        const r = new URL(redirectUri);
        r.searchParams.set("error", error);
        if (q.get("state")) r.searchParams.set("state", q.get("state")!);
        return new Response(null, { status: 302, headers: { Location: r.toString() } });
      };
      if (q.get("response_type") !== "code") return back("unsupported_response_type");
      const challenge = q.get("code_challenge") ?? "";
      if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return back("invalid_request");
      const id = rand(16);
      db.run(
        "INSERT INTO oauth_requests (id, clientId, redirectUri, challenge, state, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
        id, q.get("client_id"), redirectUri, challenge, q.get("state"), Date.now()
      );
      return new Response(null, { status: 302, headers: { Location: `/app?oauth=${id}`, "Cache-Control": "no-store" } });
    }

    // The consent screen reads who is asking (the id is unguessable and short-lived).
    const reqMatch = p.match(/^\/v1\/oauth\/request\/([0-9a-f]{32})$/);
    if (req.method === "GET" && reqMatch) {
      prune();
      const r = get<{ clientId: string; redirectUri: string; state: string | null }>("SELECT clientId, redirectUri, state FROM oauth_requests WHERE id=?", reqMatch[1]);
      const client = r && get<{ name: string }>("SELECT name FROM oauth_clients WHERE clientId=?", r.clientId);
      if (!r || !client) return json(404, { error: "This sign-in request expired. Start again from the app." });
      const deny = new URL(r.redirectUri);
      deny.searchParams.set("error", "access_denied");
      if (r.state) deny.searchParams.set("state", r.state);
      return json(200, { clientName: client.name, redirectHost: new URL(r.redirectUri).host, denyUrl: deny.toString() });
    }

    if (req.method === "POST" && p === "/oauth/token") {
      prune();
      const f = formOrJson(req, body);
      const bad = (error: string, description?: string) => json(400, { error, ...(description ? { error_description: description } : {}) });
      if (f.grant_type === "authorization_code") {
        const code = get<{ clientId: string; redirectUri: string; challenge: string; connector: string }>(
          "SELECT clientId, redirectUri, challenge, connector FROM oauth_codes WHERE hash=?", hash(f.code ?? "")
        );
        if (!code) return bad("invalid_grant", "Unknown, used or expired code");
        db.run("DELETE FROM oauth_codes WHERE hash=?", hash(f.code ?? "")); // single use, even when the rest fails
        if (code.clientId !== f.client_id || code.redirectUri !== f.redirect_uri) return bad("invalid_grant", "Code was issued to another client or redirect");
        if (!f.code_verifier || b64url(sha256(utf8(f.code_verifier))) !== code.challenge) return bad("invalid_grant", "PKCE verification failed");
        if (!connectorAlive(code.connector)) return bad("invalid_grant", "Access was revoked");
        return issueTokens(code.clientId, code.connector);
      }
      if (f.grant_type === "refresh_token") {
        const h = hash(f.refresh_token ?? "");
        const t = get<{ clientId: string; connector: string }>("SELECT clientId, connector FROM oauth_tokens WHERE hash=? AND kind='refresh'", h);
        if (!t || t.clientId !== f.client_id) return bad("invalid_grant", "Unknown or expired refresh token");
        db.run("DELETE FROM oauth_tokens WHERE hash=?", h); // rotate
        if (!connectorAlive(t.connector)) return bad("invalid_grant", "Access was revoked");
        return issueTokens(t.clientId, t.connector);
      }
      return bad("unsupported_grant_type");
    }
    return json(404, { error: "Not found" });
  }

  function approve(requestId: string, connectorToken: string, account: string): Response {
    prune();
    const r = get<{ clientId: string; redirectUri: string; challenge: string; state: string | null }>(
      "SELECT clientId, redirectUri, challenge, state FROM oauth_requests WHERE id=?", requestId
    );
    if (!r) return json(404, { error: "This sign-in request expired. Start again from the app." });
    const conn = get<{ account: string }>("SELECT account FROM connectors WHERE token=?", connectorToken);
    if (!conn || conn.account !== account) return json(403, { error: "That connector isn't yours" });
    db.run("DELETE FROM oauth_requests WHERE id=?", requestId);
    const code = rand(32);
    db.run(
      "INSERT INTO oauth_codes (hash, clientId, redirectUri, challenge, connector, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      hash(code), r.clientId, r.redirectUri, r.challenge, connectorToken, Date.now()
    );
    const back = new URL(r.redirectUri);
    back.searchParams.set("code", code);
    if (r.state) back.searchParams.set("state", r.state);
    return json(200, { redirect: back.toString() });
  }

  function bearer(req: Request, url: URL): { connector: string } | Response {
    const meta = `${publicOrigin(req, url)}/.well-known/oauth-protected-resource`;
    const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+([0-9a-f]{64})$/i);
    const deny = (extra: string) =>
      json(401, { error: "Sign in required" }, { "WWW-Authenticate": `Bearer resource_metadata="${meta}"${extra}` });
    if (!m) return deny("");
    const t = get<{ connector: string; expiresAt: number }>("SELECT connector, expiresAt FROM oauth_tokens WHERE hash=? AND kind='access'", hash(m[1].toLowerCase()));
    if (!t || t.expiresAt < Date.now() || !connectorAlive(t.connector)) return deny(', error="invalid_token"');
    return { connector: t.connector };
  }

  function forgetConnector(token: string): void {
    db.run("DELETE FROM oauth_tokens WHERE connector=?", token);
    db.run("DELETE FROM oauth_codes WHERE connector=?", token);
  }

  return { route, approve, bearer, forgetConnector };
}
