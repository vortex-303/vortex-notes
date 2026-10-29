// Pages front door (built to _worker.js): static assets from the Pages bucket,
// everything else to the relay Durable Object bound from the vortex-notes-do Worker.
import { toRelay, STATIC_PATHS, type Env } from "./edge.js";

export default {
  fetch(req: Request, env: Env & { ASSETS: { fetch(req: Request): Promise<Response> } }): Promise<Response> {
    if (req.method === "GET" && STATIC_PATHS.has(new URL(req.url).pathname)) return env.ASSETS.fetch(req);
    return toRelay(req, env);
  },
};
