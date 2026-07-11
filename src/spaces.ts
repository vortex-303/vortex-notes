/**
 * Spaces: the unit of encryption and (later) sharing/sync.
 *
 * Each space has a random 256-bit key. Membership = the space key sealed to
 * a member's X25519 public key. Locally we keep two seals per space: one to
 * this device (daily use, no phrase needed) and one to the account key
 * (recovery — any future device enrolled from the phrase can open it after
 * a re-seal exchange; and it is the seed of Phase 2 agent grants).
 */
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { randomKey, sealBox, openBox, encryptPayload, decryptPayload, toHex, fromHex, utf8 } from "./crypto.js";
import { vortexHome, type LoadedIdentity } from "./identity.js";

export interface SpaceRecord {
  id: string;
  name: string;
  createdAt: string;
  /** member fingerprint/hex pub → sealed space key (hex) */
  sealedKeys: Record<string, string>;
}

interface SpacesFile {
  v: 1;
  spaces: SpaceRecord[];
}

const spacesPath = () => path.join(vortexHome(), "spaces.json");

function load(): SpacesFile {
  if (!fs.existsSync(spacesPath())) return { v: 1, spaces: [] };
  return JSON.parse(fs.readFileSync(spacesPath(), "utf8")) as SpacesFile;
}

function save(file: SpacesFile): void {
  fs.mkdirSync(vortexHome(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(spacesPath(), JSON.stringify(file, null, 2) + "\n");
}

export function listSpaces(): SpaceRecord[] {
  return load().spaces;
}

export function createSpace(identity: LoadedIdentity, name: string): SpaceRecord {
  const key = randomKey();
  const record: SpaceRecord = {
    id: "sp-" + ulid().toLowerCase(),
    name,
    createdAt: new Date().toISOString(),
    sealedKeys: {
      [identity.file.device.signPub]: toHex(sealBox(key, identity.deviceBox.pub)),
      [identity.file.accountSignPub]: toHex(sealBox(key, fromHex(identity.file.accountEncPub))),
    },
  };
  const file = load();
  file.spaces.push(record);
  save(file);
  return record;
}

export function getSpace(idOrName: string): SpaceRecord {
  const s = load().spaces.find((s) => s.id === idOrName || s.name === idOrName);
  if (!s) throw new Error(`No space named or with id "${idOrName}".`);
  return s;
}

/** Open the space key using this device's keys (no phrase needed). */
export function openSpaceKey(identity: LoadedIdentity, space: SpaceRecord): Uint8Array {
  const sealed = space.sealedKeys[identity.file.device.signPub];
  if (!sealed) throw new Error(`This device has no key for space "${space.name}".`);
  return openBox(fromHex(sealed), identity.deviceBox);
}

/**
 * Grant access to another principal (future device, another user, an agent):
 * one sealed-box operation — this is the whole sharing mechanism.
 */
export function grantSpace(space: SpaceRecord, spaceKey: Uint8Array, memberId: string, memberEncPub: Uint8Array): void {
  const file = load();
  const s = file.spaces.find((x) => x.id === space.id);
  if (!s) throw new Error(`Space ${space.id} not found.`);
  s.sealedKeys[memberId] = toHex(sealBox(spaceKey, memberEncPub));
  save(file);
}

/** Encrypt/decrypt a document payload within a space. AAD binds blob ↔ doc id. */
export function encryptDoc(spaceKey: Uint8Array, docId: string, plaintext: string): Uint8Array {
  return encryptPayload(spaceKey, utf8(plaintext), `vortex-doc-v1:${docId}`);
}

export function decryptDoc(spaceKey: Uint8Array, docId: string, blob: Uint8Array): string {
  return new TextDecoder().decode(decryptPayload(spaceKey, blob, `vortex-doc-v1:${docId}`));
}
