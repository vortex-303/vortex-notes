// Shared edge forwarding for the Worker and the Pages front door. No imports,
// so the Pages _worker.js bundle stays tiny.
export interface Env {
  RELAY: { idFromName(name: string): unknown; get(id: unknown): { fetch(req: Request): Promise<Response> } };
  ASSETS?: { fetch(req: Request): Promise<Response> };
  RELAY_QUOTA_MB?: string;
  RELAY_ADMIN_ACCOUNT?: string;
  /** secret: 32-byte hex key encrypting cloud-agent keys at rest */
  RELAY_CONNECTOR_KEK?: string;
  /** token for ChatGPT's app directory domain check (/.well-known/openai-apps-challenge) */
  OPENAI_APPS_CHALLENGE?: string;
}

/** Forward a request to the single relay instance, with only the coarse country attached. */
export function toRelay(req: Request, env: Env): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.delete("x-vn-country"); // never trust a client-supplied value
  const country = (req as Request & { cf?: { country?: string } }).cf?.country;
  if (country) headers.set("x-vn-country", country);
  const stub = env.RELAY.get(env.RELAY.idFromName("main"));
  return stub.fetch(new Request(req, { headers }));
}

export const STATIC_PATHS = new Set([
  "/app/bundle.js",
  "/download/VortexNotes.dmg",
  "/download/VortexNotes.dmg.sha256",
  "/demo.svg",
  "/app/icon-192.png",
  "/app/icon-512.png",
  "/app/icon-180.png",
  "/app/icon-maskable-512.png",
]);
