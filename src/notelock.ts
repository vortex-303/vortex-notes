/**
 * Per-note password locks — the format shared by the web app and the CLI so
 * a note locked in one unlocks in the other. A locked note keeps its
 * frontmatter (title/dates stay visible) but its body becomes an encrypted
 * envelope. This is a SECOND layer on top of the space key, so a locked note
 * is opaque even to your own devices, granted agents, the on-disk files, and
 * search.
 *
 * v1: body sealed directly under scrypt(password) — password is the ONLY key.
 * v2: body sealed under a random content key K, and K is wrapped twice:
 *     once under scrypt(password), once sealed to the account's box pub.
 *     Either the note password or the 12-word account phrase recovers K.
 *     Sealing needs only the PUBLIC account key, so locking works in
 *     sessions that never saw the phrase.
 */
import {
  deriveNoteKey,
  encryptPayload,
  decryptPayload,
  sealBox,
  openBox,
  toB64,
  fromB64,
  utf8,
  randomKey,
} from "./crypto.js";
import { splitFrontmatter } from "./textutil.js";

export const LOCK_MARK = "vortex-locked:";
export const LOCK_AAD = "vortex-note-lock-v1"; // body ciphertext AAD (v1 and v2)
export const LOCK_KEY_AAD = "vortex-note-key-v2"; // v2 password-wrap AAD

/** Everything needed to rebuild an envelope around a new body (key travels separately). */
export interface LockMeta {
  v: 1 | 2;
  salt: Uint8Array;
  wrapPw?: Uint8Array; // v2: content key encrypted under scrypt(password, salt)
  sealedAcct?: Uint8Array; // v2: content key sealed to the account box pub
}

export interface LockEnvelope extends LockMeta {
  ct: Uint8Array;
}

/** Parse the encrypted envelope out of a note body (null if not locked). */
export function findEnvelope(body: string): LockEnvelope | null {
  const B = "([A-Za-z0-9+/=]+)";
  const v2 = body.match(new RegExp(`^vortex-locked:v2:${B}:${B}:${B}:${B}\\s*$`, "m"));
  try {
    if (v2) return { v: 2, salt: fromB64(v2[1]), wrapPw: fromB64(v2[2]), sealedAcct: fromB64(v2[3]), ct: fromB64(v2[4]) };
    const v1 = body.match(new RegExp(`^vortex-locked:v1:${B}:${B}\\s*$`, "m"));
    if (v1) return { v: 1, salt: fromB64(v1[1]), ct: fromB64(v1[2]) };
  } catch {
    return null;
  }
  return null;
}

export function isLockedContent(content: string): boolean {
  return findEnvelope(splitFrontmatter(content).body) !== null;
}

/**
 * Recover the body key from the note password. v1: the scrypt key IS the body
 * key (verified against the ciphertext). v2: scrypt key unwraps the content
 * key. Returns null on a wrong password.
 */
export function keyFromPassword(env: LockEnvelope, password: string): Uint8Array | null {
  try {
    const pwKey = deriveNoteKey(password, env.salt);
    if (env.v === 1) {
      decryptPayload(pwKey, env.ct, LOCK_AAD); // throws if wrong
      return pwKey;
    }
    return decryptPayload(pwKey, env.wrapPw!, LOCK_KEY_AAD);
  } catch {
    return null;
  }
}

/** Recover the body key with the ACCOUNT box keypair (from the 12 words). v2 only. */
export function keyFromAccount(env: LockEnvelope, accountBox: { pub: Uint8Array; priv: Uint8Array }): Uint8Array | null {
  if (env.v !== 2 || !env.sealedAcct) return null;
  try {
    return openBox(env.sealedAcct, accountBox);
  } catch {
    return null;
  }
}

/** Decrypt a locked body given its recovered key. Throws on mismatch. */
export function openLockedBody(env: LockEnvelope, key: Uint8Array): string {
  return new TextDecoder().decode(decryptPayload(key, env.ct, LOCK_AAD));
}

/** Fresh v2 lock material: random content key, wrapped for password + account. */
export function makeLock(password: string, accountBoxPub?: Uint8Array): { meta: LockMeta; key: Uint8Array } {
  const salt = randomKey();
  const key = randomKey();
  if (!accountBoxPub) {
    // No account context (local-only vault): fall back to v1.
    return { meta: { v: 1, salt }, key: deriveNoteKey(password, salt) };
  }
  return {
    meta: {
      v: 2,
      salt,
      wrapPw: encryptPayload(deriveNoteKey(password, salt), key, LOCK_KEY_AAD),
      sealedAcct: sealBox(key, accountBoxPub),
    },
    key,
  };
}

/** A locked body: a human hint plus the encrypted envelope of the plaintext. */
export function wrapLockedBody(meta: LockMeta, key: Uint8Array, plainBody: string): string {
  const ct = encryptPayload(key, utf8(plainBody), LOCK_AAD);
  const parts =
    meta.v === 2
      ? `v2:${toB64(meta.salt)}:${toB64(meta.wrapPw!)}:${toB64(meta.sealedAcct!)}:${toB64(ct)}`
      : `v1:${toB64(meta.salt)}:${toB64(ct)}`;
  return "🔒 Password-protected — open in Vortex Notes to unlock.\n\n" + LOCK_MARK + parts;
}

/** Lock a whole note (frontmatter preserved, body encrypted under `password`). */
export function lockContent(content: string, password: string, accountBoxPub?: Uint8Array): string {
  const { frontmatter, body } = splitFrontmatter(content);
  const { meta, key } = makeLock(password, accountBoxPub);
  const wrapped = wrapLockedBody(meta, key, body.replace(/^\n+/, ""));
  return frontmatter !== null ? `---\n${frontmatter}\n---\n\n${wrapped}` : wrapped;
}

/** Decrypt a locked note's body. Returns null on wrong password / not locked. */
export function unlockContent(content: string, password: string): { frontmatter: string | null; body: string } | null {
  const { frontmatter, body } = splitFrontmatter(content);
  const env = findEnvelope(body);
  if (!env) return null;
  const key = keyFromPassword(env, password);
  if (!key) return null;
  return { frontmatter, body: openLockedBody(env, key) };
}

/** Decrypt a locked note's body with the account keypair (12 words). v2 only. */
export function unlockContentWithAccount(
  content: string,
  accountBox: { pub: Uint8Array; priv: Uint8Array }
): { frontmatter: string | null; body: string } | null {
  const { frontmatter, body } = splitFrontmatter(content);
  const env = findEnvelope(body);
  if (!env) return null;
  const key = keyFromAccount(env, accountBox);
  if (!key) return null;
  return { frontmatter, body: openLockedBody(env, key) };
}
