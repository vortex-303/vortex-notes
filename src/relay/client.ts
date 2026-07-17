/**
 * Client for the sync relay: signs every request with this device's key.
 * Blobs in, blobs out — all encryption happens before data reaches here.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { sign, toHex, utf8, toB64, fromB64 } from "../crypto.js";
import type { PrincipalIdentity } from "../account.js";
import type { SpaceRecord } from "../spaces.js";

export interface AdminAccountRow {
  account: string;
  firstSeen: string | null;
  lastActive: string | null;
  updates: number;
  bytesUsed: number;
  principals: { name: string; kind: string; createdAt: string }[];
  publicTitles: string[];
  tag: string | null;
}

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
    readonly identity: PrincipalIdentity
  ) {}

  async register(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountSignPub: this.identity.file.accountSignPub,
        accountEncPub: this.identity.file.accountEncPub,
        device: this.identity.file.device,
        chain: this.identity.file.chain,
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

  /** Unauthenticated: ask to pair (the requester has no identity yet). */
  static async requestPairing(baseUrl: string, name: string, signPub: string, encPub: string): Promise<string> {
    const res = await ok(
      await fetch(`${baseUrl}/v1/pair/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, signPub, encPub }),
      })
    );
    return ((await res.json()) as { code: string }).code;
  }

  /** Unauthenticated: poll for approval. Returns the sealed grant when approved. */
  static async pollPairing(baseUrl: string, code: string, signPub: string): Promise<string | null> {
    const res = await ok(await fetch(`${baseUrl}/v1/pair/poll?code=${encodeURIComponent(code)}&signPub=${signPub}`));
    const data = (await res.json()) as { status: string; grant?: string };
    return data.status === "approved" ? (data.grant ?? null) : null;
  }

  async getPairing(code: string): Promise<{ code: string; name: string; signPub: string; encPub: string }> {
    const res = await ok(await this.signed("GET", `/v1/pair/pending?code=${encodeURIComponent(code)}`));
    return (await res.json()) as { code: string; name: string; signPub: string; encPub: string };
  }

  async approvePairing(code: string, grantB64: string): Promise<void> {
    await ok(await this.signed("POST", "/v1/pair/approve", { code, grant: grantB64 }));
  }

  async publishNote(opts: { slug?: string; path: string; title: string; author: string | null; theme: string; markdown: string }): Promise<string> {
    const res = await ok(await this.signed("PUT", "/v1/public", opts));
    return ((await res.json()) as { slug: string }).slug;
  }

  async unpublishNote(slug: string): Promise<void> {
    await ok(await this.signed("DELETE", `/v1/public/${slug}`));
  }

  async listPublic(): Promise<{ slug: string; path: string; title: string; author: string | null; theme: string; updatedAt: string }[]> {
    const res = await ok(await this.signed("GET", "/v1/public"));
    return ((await res.json()) as { published: { slug: string; path: string; title: string; author: string | null; theme: string; updatedAt: string }[] }).published;
  }

  async getAdminStats(): Promise<Record<string, unknown>> {
    const res = await ok(await this.signed("GET", "/v1/admin/stats"));
    return (await res.json()) as Record<string, unknown>;
  }

  async getAdminAccounts(): Promise<AdminAccountRow[]> {
    const res = await ok(await this.signed("GET", "/v1/admin/accounts"));
    return ((await res.json()) as { accounts: AdminAccountRow[] }).accounts;
  }

  async setAdminTag(account: string, tag: string | null): Promise<void> {
    await ok(await this.signed("PUT", "/v1/admin/tag", { account, tag: tag ?? undefined }));
  }

  async getUsage(): Promise<{ bytesUsed: number; quotaBytes: number | null }> {
    const res = await ok(await this.signed("GET", "/v1/usage"));
    return (await res.json()) as { bytesUsed: number; quotaBytes: number | null };
  }

  async listPrincipals(): Promise<
    { signPub: string; name: string; kind: string; spaces?: string[]; mode?: string; registeredAt: string }[]
  > {
    const res = await ok(await this.signed("GET", "/v1/principals"));
    return ((await res.json()) as { principals: { signPub: string; name: string; kind: string; spaces?: string[]; mode?: string; registeredAt: string }[] }).principals;
  }

  async revokePrincipal(signPub: string): Promise<void> {
    await ok(await this.signed("DELETE", `/v1/principals/${signPub}`));
  }

  async pushUpdate(spaceId: string, docId: string, blob: Uint8Array): Promise<number> {
    const res = await ok(
      await this.signed("POST", `/v1/spaces/${spaceId}/docs/${encodeURIComponent(docId)}`, {
        blob: toB64(blob),
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
    return data.updates.map((u) => ({ ...u, blob: fromB64(u.blob) }));
  }

  private async signed(method: string, pathWithQuery: string, body?: unknown): Promise<Response> {
    const raw = body === undefined ? new Uint8Array(0) : utf8(JSON.stringify(body));
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
      body: raw.length ? (raw as unknown as BodyInit) : undefined,
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
