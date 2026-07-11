/**
 * Vault ↔ relay sync (v0: whole-note last-writer-wins).
 *
 * Each note file is a doc (docId = vault-relative path). An update is the
 * full file content, encrypted with the space key, AAD-bound to the path.
 * Pull runs before push; a note edited both locally and remotely resolves
 * by newest mtime, and the loser is preserved as <name>.conflict-<ts>.md —
 * sync never silently discards words. Deletions don't sync in v0.
 * CRDT-per-note replaces this in slice 1e without changing the relay.
 */
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { Vault } from "./vault.js";
import { RelayClient } from "./relay/client.js";
import { openBox, fromHex, toHex, utf8, encryptPayload, decryptPayload, sealBox } from "./crypto.js";
import { loadIdentity, accountFromPhrase, vortexHome, type LoadedIdentity } from "./identity.js";
import { createSpace, getSpace, openSpaceKey, listSpaces, type SpaceRecord } from "./spaces.js";

export interface SyncState {
  v: 1;
  relay: string;
  spaceId: string;
  cursor: number;
  /** path → sha256 of file content as of last successful sync */
  files: Record<string, string>;
}

interface DocPayload {
  v: 1;
  path: string;
  content: string;
  mtimeMs: number;
}

const statePath = (vault: Vault) => path.join(vault.metaDir, "sync.json");

export function loadSyncState(vault: Vault): SyncState | null {
  if (!fs.existsSync(statePath(vault))) return null;
  return JSON.parse(fs.readFileSync(statePath(vault), "utf8")) as SyncState;
}

function saveSyncState(vault: Vault, state: SyncState): void {
  fs.writeFileSync(statePath(vault), JSON.stringify(state, null, 2) + "\n");
}

/** Machine 1: link this vault to a (new or existing) local space and announce it on the relay. */
export async function linkVault(vault: Vault, relayUrl: string, spaceName: string): Promise<SyncState> {
  if (loadSyncState(vault)) throw new Error("This vault is already linked. Run 'vortex-notes sync' instead.");
  const identity = loadIdentity();
  let space: SpaceRecord;
  try {
    space = getSpace(spaceName);
  } catch {
    space = createSpace(identity, spaceName);
  }
  const client = new RelayClient(relayUrl, identity);
  await client.register();
  await client.createSpace(space);
  const state: SyncState = { v: 1, relay: relayUrl, spaceId: space.id, cursor: 0, files: {} };
  saveSyncState(vault, state);
  return state;
}

/**
 * Machine 2: join a space from the relay. The space key arrives sealed to the
 * ACCOUNT key, so the recovery phrase is needed once; we then re-seal it to
 * this device so future syncs need no phrase.
 */
export async function joinVault(
  vault: Vault,
  relayUrl: string,
  phrase: string,
  spaceId?: string
): Promise<SyncState> {
  if (loadSyncState(vault)) throw new Error("This vault is already linked.");
  const identity = loadIdentity();
  const account = accountFromPhrase(phrase);
  if (toHex(account.sign.pub) !== identity.file.accountSignPub) {
    throw new Error("That phrase belongs to a different account than this machine's identity.");
  }
  const client = new RelayClient(relayUrl, identity);
  await client.register();
  const remote = await client.listSpaces();
  if (!remote.length) throw new Error("No spaces on the relay for this account.");
  const chosen = spaceId ? remote.find((s) => s.id === spaceId) : remote[0];
  if (!chosen) throw new Error(`Space ${spaceId} not found on relay. Available: ${remote.map((s) => s.id).join(", ")}`);
  if (remote.length > 1 && !spaceId) {
    throw new Error(`Multiple spaces on relay — pass --space <id>. Available: ${remote.map((s) => s.id).join(", ")}`);
  }

  const sealedForAccount = chosen.sealedKeys[identity.file.accountSignPub];
  if (!sealedForAccount) throw new Error("Relay copy of this space has no key sealed to your account.");
  const spaceKey = openBox(fromHex(sealedForAccount), account.box);

  // Adopt locally: same record shape as createSpace, key re-sealed to this device.
  adoptSpace(identity, chosen.id, chosen.createdAt, spaceKey, chosen.sealedKeys);

  const state: SyncState = { v: 1, relay: relayUrl, spaceId: chosen.id, cursor: 0, files: {} };
  saveSyncState(vault, state);
  return state;
}

function adoptSpace(
  identity: LoadedIdentity,
  id: string,
  createdAt: string,
  spaceKey: Uint8Array,
  existingSeals: Record<string, string>
): void {
  const spacesFile = path.join(vortexHome(), "spaces.json");
  const file = fs.existsSync(spacesFile)
    ? (JSON.parse(fs.readFileSync(spacesFile, "utf8")) as { v: 1; spaces: SpaceRecord[] })
    : { v: 1 as const, spaces: [] as SpaceRecord[] };
  if (file.spaces.some((s) => s.id === id)) return;
  file.spaces.push({
    id,
    name: id,
    createdAt,
    sealedKeys: { ...existingSeals, [identity.file.device.signPub]: toHex(sealBox(spaceKey, identity.deviceBox.pub)) },
  });
  fs.mkdirSync(path.dirname(spacesFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(spacesFile, JSON.stringify(file, null, 2) + "\n");
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  conflicts: string[];
}

/** Pull remote updates, resolve conflicts (LWW + conflict file), push local changes. */
export async function syncVault(vault: Vault): Promise<SyncResult> {
  const state = loadSyncState(vault);
  if (!state) throw new Error("Vault not linked. Run 'vortex-notes sync link' (or 'sync join' on a second machine).");
  const identity = loadIdentity();
  const space = getSpace(state.spaceId);
  const key = openSpaceKey(identity, space);
  const client = new RelayClient(state.relay, identity);
  const result: SyncResult = { pulled: 0, pushed: 0, conflicts: [] };

  // ---- pull ----
  const updates = await client.pullUpdates(state.spaceId, state.cursor);
  // Only the newest update per doc matters in LWW.
  const latest = new Map<string, (typeof updates)[number]>();
  for (const u of updates) latest.set(u.doc, u);
  for (const u of latest.values()) {
    state.cursor = Math.max(state.cursor, u.seq);
    if (u.author === identity.file.device.signPub) continue; // our own echo
    const payload = JSON.parse(
      new TextDecoder().decode(decryptPayload(key, u.blob, `vortex-doc-v1:${u.doc}`))
    ) as DocPayload;
    const rel = payload.path;
    if (!vault.isNotePath(rel)) continue;
    const abs = vault.abs(rel);
    const localExists = fs.existsSync(abs);
    const localContent = localExists ? fs.readFileSync(abs, "utf8") : null;
    const localHash = localContent === null ? null : hashOf(localContent);
    const remoteHash = hashOf(payload.content);

    if (localHash === remoteHash) {
      state.files[rel] = remoteHash;
      continue;
    }
    const locallyModified = localExists && state.files[rel] !== undefined && localHash !== state.files[rel];
    const locallyNew = localExists && state.files[rel] === undefined;
    if ((locallyModified || locallyNew) && localContent !== null) {
      const localMtime = fs.statSync(abs).mtimeMs;
      if (localMtime >= payload.mtimeMs) {
        // Local wins; remote version preserved as a conflict file. Push happens below.
        const conflictRel = rel.replace(/\.md$/, `.conflict-${Date.now()}.md`);
        fs.writeFileSync(vault.abs(conflictRel), payload.content);
        result.conflicts.push(conflictRel);
        continue;
      }
      const conflictRel = rel.replace(/\.md$/, `.conflict-${Date.now()}.md`);
      fs.writeFileSync(vault.abs(conflictRel), localContent);
      result.conflicts.push(conflictRel);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, payload.content);
    state.files[rel] = remoteHash;
    result.pulled++;
  }
  // Cursor may also advance past our own echoes even when latest-per-doc skipped them.
  for (const u of updates) state.cursor = Math.max(state.cursor, u.seq);

  // ---- push ----
  for (const rel of vault.listNoteFiles()) {
    const content = fs.readFileSync(vault.abs(rel), "utf8");
    const h = hashOf(content);
    if (state.files[rel] === h) continue;
    const payload: DocPayload = { v: 1, path: rel, content, mtimeMs: fs.statSync(vault.abs(rel)).mtimeMs };
    const blob = encryptPayload(key, utf8(JSON.stringify(payload)), `vortex-doc-v1:${rel}`);
    const seq = await client.pushUpdate(state.spaceId, rel, blob);
    state.cursor = Math.max(state.cursor, seq);
    state.files[rel] = h;
    result.pushed++;
  }

  saveSyncState(vault, state);
  return result;
}

function hashOf(content: string): string {
  return toHex(sha256(utf8(content)));
}
