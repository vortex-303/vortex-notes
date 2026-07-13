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
  kind: "device" | "agent";
  signPub: string;
  encPub: string;
  name: string;
  createdAt: string;
  /** agent-only: space ids this principal may touch — relay-enforced, signed into the cert */
  spaces?: string[];
  /** agent-only: "ro" = search/read only */
  mode?: "ro" | "rw";
  /** agent-only: signPub of the certifying device (chain: account → device → agent) */
  signedBy?: string;
}

export type SignedCert = DeviceCertPayload & { certSig: string };

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
  signerPub: Uint8Array,
  device: DeviceCertPayload & { certSig: string }
): boolean {
  const { certSig, ...payload } = device;
  return verify(fromHex(certSig), canonical(payload as unknown as Record<string, unknown>), signerPub);
}

/**
 * Certify an agent with a DEVICE key (no phrase needed — the chain is
 * account → device → agent). Scope and mode are inside the signature, so
 * the relay can enforce them without trusting the agent.
 */
export function certifyAgent(
  deviceSign: SignKeypair,
  agentSignPub: Uint8Array,
  agentEncPub: Uint8Array,
  name: string,
  spaces: string[],
  mode: "ro" | "rw"
): SignedCert {
  const payload: DeviceCertPayload = {
    v: 1,
    kind: "agent",
    signPub: toHex(agentSignPub),
    encPub: toHex(agentEncPub),
    name,
    createdAt: new Date().toISOString(),
    spaces,
    mode,
    signedBy: toHex(deviceSign.pub),
  };
  const certSig = toHex(sign(canonical(payload as unknown as Record<string, unknown>), deviceSign.priv));
  return { ...payload, certSig };
}

/** Verify the full agent chain: device cert under the account, agent cert under the device. */
export function verifyAgentChain(
  accountSignPub: Uint8Array,
  agentCert: SignedCert,
  deviceCert: SignedCert
): boolean {
  if (agentCert.kind !== "agent" || deviceCert.kind !== "device") return false;
  if (agentCert.signedBy !== deviceCert.signPub) return false;
  return (
    verifyDeviceCert(accountSignPub, deviceCert) &&
    verifyDeviceCert(fromHex(deviceCert.signPub), agentCert)
  );
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
    /** agents only: the certifying device's cert (account → device → agent) */
    chain?: SignedCert;
  };
  deviceSign: SignKeypair;
  deviceBox: BoxKeypair;
}
