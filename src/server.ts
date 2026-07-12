import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { marked } from "marked";
import { Vault, slugify } from "./vault.js";
import { Indexer, startVaultWatcher } from "./indexer.js";
import { search } from "./search.js";
import { htmlShell } from "./webui.js";
import { startAutoSync } from "./autosync.js";

export interface ServeOptions {
  port: number;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

export async function startWebServer(
  vault: Vault,
  opts: ServeOptions
): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  if (!vault.exists()) vault.init();
  const indexer = new Indexer(vault);
  void indexer.indexAll().then(
    (r) => console.error(`[vortex-notes] index ready: ${r.total} notes (${r.indexed} refreshed)`),
    (err) => console.error(`[vortex-notes] index error: ${err.message}`)
  );

  const sseClients = new Set<http.ServerResponse>();
  const broadcast = (rel: string) => {
    const msg = `data: ${JSON.stringify({ type: "change", path: rel })}\n\n`;
    for (const res of sseClients) res.write(msg);
  };
  const watcher = startVaultWatcher(vault, indexer, broadcast);
  const autoSync = startAutoSync(vault); // no-op unless the vault is linked to a relay
  const afterWrite = (rel: string) => {
    indexer.indexNote(rel);
    void indexer.embedPending();
    broadcast(rel);
  };

  /**
   * Mutations require Content-Type: application/json — cross-origin pages
   * can't send that to localhost without a CORS preflight, which we never
   * answer, so random websites can't write to the vault.
   */
  const readJson = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      if (!/^application\/json/.test(req.headers["content-type"] ?? "")) {
        reject(new Error("Content-Type must be application/json"));
        return;
      }
      let data = "";
      req.on("data", (c) => {
        data += c;
        if (data.length > 2_000_000) req.destroy();
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(data || "{}"));
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });

  /** Resolve [[wikilink]] targets to note paths via title or basename. */
  const resolver = (): Map<string, string> => {
    const byKey = new Map<string, string>();
    const all = indexer.db.prepare("SELECT path, title FROM notes").all() as {
      path: string;
      title: string;
    }[];
    for (const n of all) {
      byKey.set(n.title.toLowerCase(), n.path);
      byKey.set((n.path.split("/").pop() ?? "").replace(/\.md$/, "").toLowerCase(), n.path);
    }
    return byKey;
  };

  const renderNote = (rel: string): { title: string; tags: string[]; body: string; html: string; updated?: string } => {
    const note = vault.readNote(rel);
    const byKey = resolver();
    // [[Target|alias]] / [[Target#heading]] → app links (or a muted span when unresolved)
    const withLinks = note.body.replace(
      /\[\[([^\][|#]+)(#[^\][|]*)?(?:\|([^\]]*))?\]\]/g,
      (_m, target: string, _hash: string, alias: string) => {
        const to = byKey.get(target.trim().toLowerCase());
        const label = (alias ?? target).trim();
        return to
          ? `<a href="#/note/${encodeURIComponent(to)}" class="wikilink">${escapeHtml(label)}</a>`
          : `<span class="wikilink broken" title="No note named “${escapeHtml(target.trim())}”">${escapeHtml(label)}</span>`;
      }
    );
    let html = marked.parse(withLinks, { async: false }) as string;
    // Relative image/asset paths → /raw/, resolved against the note's folder.
    const dir = path.posix.dirname(rel);
    html = html.replace(/(src|href)="(?!https?:|data:|mailto:|#|\/)([^"]+)"/g, (_m, attr, url) => {
      const target = path.posix.normalize(dir === "." ? url : `${dir}/${url}`);
      return `${attr}="/raw/${target.split("/").map(encodeURIComponent).join("/")}"`;
    });
    return { title: note.title, tags: note.tags, body: note.body, html, updated: note.updated };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": type, ...headers });
      res.end(body);
    };
    const json = (data: unknown) => send(200, "application/json", JSON.stringify(data));

    try {
      if (url.pathname === "/") {
        const nonce = crypto.randomBytes(16).toString("base64");
        return send(200, "text/html; charset=utf-8", htmlShell(nonce, vault.root), {
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'`,
        });
      }
      if (url.pathname === "/api/notes") {
        const rows = indexer.db
          .prepare("SELECT path, title, mtime FROM notes ORDER BY path")
          .all();
        return json(rows);
      }
      if (url.pathname === "/api/note" && req.method === "POST") {
        const b = await readJson(req);
        const title = String(b.title ?? "").trim();
        if (!title) return send(400, "application/json", JSON.stringify({ error: "title required" }));
        const folder = String(b.folder ?? "").trim().replace(/^\/+|\/+$/g, "");
        const rel = path.posix.join(folder, slugify(title) + ".md");
        if (fs.existsSync(vault.abs(rel))) {
          return send(409, "application/json", JSON.stringify({ error: `Already exists: ${rel}` }));
        }
        vault.writeNote(rel, title, String(b.content ?? ""), Array.isArray(b.tags) ? b.tags.map(String) : []);
        afterWrite(rel);
        return json({ path: rel });
      }
      if (url.pathname === "/api/note" && req.method === "PUT") {
        const rel = url.searchParams.get("path") ?? "";
        if (!vault.isNotePath(rel) || !fs.existsSync(vault.abs(rel))) {
          return send(404, "application/json", JSON.stringify({ error: `Not found: ${rel}` }));
        }
        const b = await readJson(req);
        vault.updateNote(rel, String(b.body ?? ""));
        afterWrite(rel);
        return json({ path: rel, ...renderNote(rel) });
      }
      if (url.pathname === "/api/note" && req.method === "DELETE") {
        const rel = url.searchParams.get("path") ?? "";
        if (!vault.isNotePath(rel) || !fs.existsSync(vault.abs(rel))) {
          return send(404, "application/json", JSON.stringify({ error: `Not found: ${rel}` }));
        }
        if (!/^application\/json/.test(req.headers["content-type"] ?? "")) {
          return send(400, "application/json", JSON.stringify({ error: "Content-Type must be application/json" }));
        }
        fs.rmSync(vault.abs(rel));
        indexer.removeNote(rel);
        broadcast(rel);
        return json({ ok: true });
      }
      if (url.pathname === "/api/daily" && req.method === "POST") {
        const b = await readJson(req);
        const content = String(b.content ?? "").trim();
        if (!content) return send(400, "application/json", JSON.stringify({ error: "content required" }));
        const rel = vault.appendDaily(content);
        afterWrite(rel);
        return json({ path: rel });
      }
      if (url.pathname === "/api/note") {
        const rel = url.searchParams.get("path") ?? "";
        if (!vault.isNotePath(rel) || !fs.existsSync(vault.abs(rel))) {
          return send(404, "application/json", JSON.stringify({ error: `Not found: ${rel}` }));
        }
        return json({ path: rel, ...renderNote(rel) });
      }
      if (url.pathname === "/api/search") {
        const q = url.searchParams.get("q") ?? "";
        if (!q.trim()) return json([]);
        return json(await search(indexer, q, 12));
      }
      if (url.pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("data: {\"type\":\"hello\"}\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }
      if (url.pathname.startsWith("/raw/")) {
        const rel = decodeURIComponent(url.pathname.slice(5));
        const abs = vault.abs(rel); // throws on escape
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          return send(404, "text/plain", "Not found");
        }
        const ext = path.extname(abs).toLowerCase();
        return send(200, MIME[ext] ?? "application/octet-stream", fs.readFileSync(abs));
      }
      return send(404, "text/plain", "Not found");
    } catch (err) {
      return send(400, "application/json", JSON.stringify({ error: (err as Error).message }));
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const close = async () => {
    autoSync.stop();
    for (const res of sseClients) res.end();
    sseClients.clear();
    await watcher.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    indexer.close();
  };
  return { server, port, close };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
