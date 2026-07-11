/**
 * Client for the sync relay: signs every request with this device's key.
 * Blobs in, blobs out — all encryption happens before data reaches here.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { sign, toHex, utf8 } from "../crypto.js";
import type { LoadedIdentity } from "../identity.js";
import type { SpaceRecord } from "../spaces.js";

export interface RemoteUpdate {
  seq: number;
  doc: string;
  author: string;
  ts: string;
  blob: Uint8Array;
}

export class RelayClient {
  constructor(
    readonly baseUrl: string,
    readonly identity: LoadedIdentity
  ) {}

  async register(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountSignPub: this.identity.file.accountSignPub,
        accountEncPub: this.identity.file.accountEncPub,
        device: this.identity.file.device,
      }),
    });
    await ok(res);
  }

  async createSpace(space: SpaceRecord): Promise<void> {
    await ok(await this.signed("PUT", `/v1/spaces/${space.id}`, { sealedKeys: space.sealedKeys }));
  }

  async listSpaces(): Promise<{ id: string; sealedKeys: Record<string, string>; createdAt: string }[]> {
    const data = (await (await ok(await this.signed("GET", "/v1/spaces"))).json()) as {
      spaces: { id: string; sealedKeys: Record<string, string>; createdAt: string }[];
    };
    return data.spaces;
  }

  async pushUpdate(spaceId: string, docId: string, blob: Uint8Array): Promise<number> {
    const res = await ok(
      await this.signed("POST", `/v1/spaces/${spaceId}/docs/${encodeURIComponent(docId)}`, {
        blob: Buffer.from(blob).toString("base64"),
      })
    );
    return ((await res.json()) as { seq: number }).seq;
  }

  async pullUpdates(spaceId: string, since = 0, docId?: string): Promise<RemoteUpdate[]> {
    const qs = new URLSearchParams({ since: String(since) });
    if (docId) qs.set("doc", docId);
    const res = await ok(await this.signed("GET", `/v1/spaces/${spaceId}?${qs}`));
    const data = (await res.json()) as {
      updates: { seq: number; doc: string; author: string; ts: string; blob: string }[];
    };
    return data.updates.map((u) => ({ ...u, blob: new Uint8Array(Buffer.from(u.blob, "base64")) }));
  }

  private async signed(method: string, pathWithQuery: string, body?: unknown): Promise<Response> {
    const raw = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const ts = String(Date.now());
    const canonical = `${method}\n${pathWithQuery}\n${ts}\n${toHex(sha256(raw))}`;
    const sig = toHex(sign(utf8(canonical), this.identity.deviceSign.priv));
    return fetch(`${this.baseUrl}${pathWithQuery}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-vortex-device": this.identity.file.device.signPub,
        "x-vortex-ts": ts,
        "x-vortex-sig": sig,
      },
      body: raw.length ? raw : undefined,
    });
  }
}

async function ok(res: Response): Promise<Response> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch { /* keep default */ }
    throw new Error(`Relay: ${msg}`);
  }
  return res;
}
