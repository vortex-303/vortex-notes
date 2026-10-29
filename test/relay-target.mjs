// Where browser e2e suites point: a fresh in-process Node relay by default, or
// an already-running relay (e.g. `wrangler dev` of the Cloudflare build) via E2E_BASE.
import { startRelay } from "../dist/relay/server.js";

export async function relayTarget(opts = {}) {
  if (process.env.E2E_BASE) return { base: process.env.E2E_BASE.replace(/\/$/, ""), close: async () => {} };
  const relay = await startRelay({ port: 0, ...opts });
  return { base: `http://127.0.0.1:${relay.port}`, close: relay.close };
}
