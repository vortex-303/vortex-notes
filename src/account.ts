/**
 * Pure account/device crypto — no filesystem, safe to bundle for the browser.
 * The phrase-derived key hierarchy is documented in identity.ts.
 */
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  derive,
  signKeypairFromSeed,
  boxKeypairFromSeed,
  sign,
  verify,
  fingerprint,
  toHex,
  fromHex,
  utf8,
  type SignKeypair,
  type BoxKeypair,
} from "./crypto.js";

export interface AccountKeys {
  sign: SignKeypair;
  box: BoxKeypair;
  fingerprint: string;
}

export interface DeviceCertPayload {
  v: 1;
  kind: "device";
  signPub: string;
  encPub: string;
  name: string;
  createdAt: string;
}

export function generatePhrase(): string {
  return generateMnemonic(wordlist, 128); // 12 words
}

export function accountFromPhrase(phrase: string): AccountKeys {
  const normalized = phrase.trim().toLowerCase().split(/\s+/).join(" ");
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error("Not a valid recovery phrase (12 English words, check for typos).");
  }
  const seed = mnemonicToSeedSync(normalized);
  const signKp = signKeypairFromSeed(derive(seed, "vortex-account-sign-v1"));
  const boxKp = boxKeypairFromSeed(derive(seed, "vortex-account-encrypt-v1"));
  return { sign: signKp, box: boxKp, fingerprint: fingerprint(signKp.pub) };
}

/** Canonical JSON: sorted keys, no whitespace — stable across runtimes for signing. */
export function canonical(obj: Record<string, unknown>): Uint8Array {
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));
  return utf8(JSON.stringify(sorted));
}

export function certifyDevice(
  account: AccountKeys,
  deviceSign: SignKeypair,
  deviceBox: BoxKeypair,
  name: string
): DeviceCertPayload & { certSig: string } {
  const payload: DeviceCertPayload = {
    v: 1,
    kind: "device",
    signPub: toHex(deviceSign.pub),
    encPub: toHex(deviceBox.pub),
    name,
    createdAt: new Date().toISOString(),
  };
  const certSig = toHex(sign(canonical(payload as unknown as Record<string, unknown>), account.sign.priv));
  return { ...payload, certSig };
}

export function verifyDeviceCert(
  accountSignPub: Uint8Array,
  device: DeviceCertPayload & { certSig: string }
): boolean {
  const { certSig, ...payload } = device;
  return verify(fromHex(certSig), canonical(payload as unknown as Record<string, unknown>), accountSignPub);
}

/**
 * The minimal identity shape the relay client needs — satisfied both by the
 * fs-backed LoadedIdentity (CLI/daemon) and by a browser-session identity.
 */
export interface PrincipalIdentity {
  file: {
    accountSignPub: string;
    accountEncPub: string;
    device: DeviceCertPayload & { certSig: string };
  };
  deviceSign: SignKeypair;
  deviceBox: BoxKeypair;
}
