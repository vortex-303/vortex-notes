/**
 * Crypto primitives for Vortex Notes E2EE.
 *
 * Design (see PLAN.md Phase 1):
 * - Account keys are derived deterministically from a BIP39 recovery phrase.
 * - Every principal (account, device, later: agent) is an Ed25519 signing
 *   keypair + X25519 encryption keypair.
 * - A space has a random 256-bit symmetric key, sealed to each member's
 *   X25519 public key (anonymous sealed box: ephemeral ECDH + XChaCha20-
 *   Poly1305). Granting access = one seal; revoking = rotate + re-seal.
 * - Payloads are encrypted with XChaCha20-Poly1305; AAD binds ciphertexts
 *   to their context (doc id) so blobs can't be swapped around.
 */
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

export const KEY_LEN = 32;
const NONCE_LEN = 24;

export interface SignKeypair {
  priv: Uint8Array; // 32-byte seed
  pub: Uint8Array;
}
export interface BoxKeypair {
  priv: Uint8Array;
  pub: Uint8Array;
}

export function derive(ikm: Uint8Array, info: string, len = KEY_LEN): Uint8Array {
  return hkdf(sha256, ikm, undefined, utf8(info), len);
}

export function signKeypairFromSeed(seed: Uint8Array): SignKeypair {
  return { priv: seed, pub: ed25519.getPublicKey(seed) };
}

export function randomSignKeypair(): SignKeypair {
  return signKeypairFromSeed(randomBytes(KEY_LEN));
}

export function boxKeypairFromSeed(seed: Uint8Array): BoxKeypair {
  return { priv: seed, pub: x25519.getPublicKey(seed) };
}

export function randomBoxKeypair(): BoxKeypair {
  return boxKeypairFromSeed(randomBytes(KEY_LEN));
}

export function sign(message: Uint8Array, priv: Uint8Array): Uint8Array {
  return ed25519.sign(message, priv);
}

export function verify(sig: Uint8Array, message: Uint8Array, pub: Uint8Array): boolean {
  try {
    return ed25519.verify(sig, message, pub);
  } catch {
    return false;
  }
}

export function randomKey(): Uint8Array {
  return randomBytes(KEY_LEN);
}

/**
 * Anonymous sealed box: only the recipient's private key can open it, and
 * the sender needs nothing but the recipient's public key.
 * Layout: ephemeralPub(32) || nonce(24) || ciphertext.
 */
export function sealBox(data: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  const eph = randomBoxKeypair();
  const shared = x25519.getSharedSecret(eph.priv, recipientPub);
  const key = hkdf(sha256, shared, concat(eph.pub, recipientPub), utf8("vortex-seal-v1"), KEY_LEN);
  const nonce = randomBytes(NONCE_LEN);
  const ct = xchacha20poly1305(key, nonce).encrypt(data);
  return concat(eph.pub, nonce, ct);
}

export function openBox(sealed: Uint8Array, recipient: BoxKeypair): Uint8Array {
  if (sealed.length < KEY_LEN + NONCE_LEN + 16) throw new Error("Sealed box too short");
  const ephPub = sealed.slice(0, KEY_LEN);
  const nonce = sealed.slice(KEY_LEN, KEY_LEN + NONCE_LEN);
  const ct = sealed.slice(KEY_LEN + NONCE_LEN);
  const shared = x25519.getSharedSecret(recipient.priv, ephPub);
  const key = hkdf(sha256, shared, concat(ephPub, recipient.pub), utf8("vortex-seal-v1"), KEY_LEN);
  return xchacha20poly1305(key, nonce).decrypt(ct); // throws on tamper
}

/** Symmetric payload encryption. AAD binds the blob to its context (e.g. doc id). */
export function encryptPayload(key: Uint8Array, data: Uint8Array, aad?: string): Uint8Array {
  const nonce = randomBytes(NONCE_LEN);
  const ct = xchacha20poly1305(key, nonce, aad ? utf8(aad) : undefined).encrypt(data);
  return concat(nonce, ct);
}

export function decryptPayload(key: Uint8Array, blob: Uint8Array, aad?: string): Uint8Array {
  if (blob.length < NONCE_LEN + 16) throw new Error("Ciphertext too short");
  const nonce = blob.slice(0, NONCE_LEN);
  const ct = blob.slice(NONCE_LEN);
  return xchacha20poly1305(key, nonce, aad ? utf8(aad) : undefined).decrypt(ct);
}

export function fingerprint(pub: Uint8Array): string {
  const h = sha256(pub);
  return Array.from(h.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .replace(/(.{4})(?=.)/g, "$1-");
}

export function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/i.test(hex)) throw new Error("Invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
