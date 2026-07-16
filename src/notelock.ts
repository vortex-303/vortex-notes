/**
 * Per-note password locks — the format shared by the web app and the CLI so
 * a note locked in one unlocks in the other. A locked note keeps its
 * frontmatter (title/dates stay visible) but its body becomes an encrypted
 * envelope: a key is derived from the password with scrypt, and the plaintext
 * body is sealed with XChaCha20-Poly1305. This is a SECOND layer on top of the
 * space key, so a locked note is opaque even to your own devices, granted
 * agents, the on-disk files, and search.
 */
import { deriveNoteKey, encryptPayload, decryptPayload, toB64, fromB64, utf8, randomKey } from "./crypto.js";
import { splitFrontmatter } from "./textutil.js";

export const LOCK_MARK = "vortex-locked:v1:";
export const LOCK_AAD = "vortex-note-lock-v1";

/** Parse the encrypted envelope out of a note body (null if not locked). */
export function findEnvelope(body: string): { salt: Uint8Array; ct: Uint8Array } | null {
  const m = body.match(/^vortex-locked:v1:([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)\s*$/m);
  if (!m) return null;
  try {
    return { salt: fromB64(m[1]), ct: fromB64(m[2]) };
  } catch {
    return null;
  }
}

export function isLockedContent(content: string): boolean {
  return findEnvelope(splitFrontmatter(content).body) !== null;
}

/** A locked body: a human hint plus the encrypted envelope of the plaintext. */
export function wrapLockedBody(salt: Uint8Array, key: Uint8Array, plainBody: string): string {
  const ct = encryptPayload(key, utf8(plainBody), LOCK_AAD);
  return "🔒 Password-protected — open in Vortex Notes to unlock.\n\n" + LOCK_MARK + toB64(salt) + ":" + toB64(ct);
}

/** Lock a whole note (frontmatter preserved, body encrypted under `password`). */
export function lockContent(content: string, password: string): string {
  const { frontmatter, body } = splitFrontmatter(content);
  const salt = randomKey();
  const key = deriveNoteKey(password, salt);
  const wrapped = wrapLockedBody(salt, key, body.replace(/^\n+/, ""));
  return frontmatter !== null ? `---\n${frontmatter}\n---\n\n${wrapped}` : wrapped;
}

/** Decrypt a locked note's body. Returns null on wrong password / not locked. */
export function unlockContent(content: string, password: string): { frontmatter: string | null; body: string } | null {
  const { frontmatter, body } = splitFrontmatter(content);
  const env = findEnvelope(body);
  if (!env) return null;
  try {
    const key = deriveNoteKey(password, env.salt);
    return { frontmatter, body: new TextDecoder().decode(decryptPayload(key, env.ct, LOCK_AAD)) };
  } catch {
    return null;
  }
}
