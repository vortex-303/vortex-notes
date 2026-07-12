/**
 * Identity: the recovery phrase IS the account.
 *
 * phrase (BIP39, 12 words)
 *   └─ seed (PBKDF2-SHA512, BIP39 standard)
 *        ├─ HKDF "vortex-account-sign-v1"    → account Ed25519 keypair
 *        └─ HKDF "vortex-account-encrypt-v1" → account X25519 keypair
 *
 * The account private keys are derived on demand (init, login, device
 * certification) and never written to disk. Each machine gets random
 * DEVICE keypairs, certified by the account signing key; device secrets
 * live in ~/.vortex-notes/device.key (0600). Day-to-day operations use
 * device keys only — the phrase stays in the drawer.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  signKeypairFromSeed,
  boxKeypairFromSeed,
  randomSignKeypair,
  randomBoxKeypair,
  toHex,
  fromHex,
  type SignKeypair,
  type BoxKeypair,
} from "./crypto.js";
import {
  generatePhrase,
  accountFromPhrase,
  canonical,
  certifyDevice,
  verifyDeviceCert,
  type AccountKeys,
  type DeviceCertPayload,
} from "./account.js";

export {
  generatePhrase,
  accountFromPhrase,
  canonical,
  certifyDevice,
  verifyDeviceCert,
  type AccountKeys,
  type DeviceCertPayload,
};

export interface IdentityFile {
  v: 1;
  accountSignPub: string;
  accountEncPub: string;
  fingerprint: string;
  device: DeviceCertPayload & { certSig: string };
  createdAt: string;
}

export interface LoadedIdentity {
  file: IdentityFile;
  deviceSign: SignKeypair;
  deviceBox: BoxKeypair;
}

export function vortexHome(): string {
  return process.env.VORTEX_NOTES_HOME ?? path.join(os.homedir(), ".vortex-notes");
}

const identityPath = () => path.join(vortexHome(), "identity.json");
const deviceKeyPath = () => path.join(vortexHome(), "device.key");

/** Create a brand-new identity. Returns the phrase — shown once, never stored. */
export function initIdentity(deviceName: string): { phrase: string; identity: LoadedIdentity } {
  if (fs.existsSync(identityPath())) {
    throw new Error(`Identity already exists at ${identityPath()}. Use 'identity show', or delete it to start over.`);
  }
  const phrase = generatePhrase();
  return { phrase, identity: enrollDevice(accountFromPhrase(phrase), deviceName) };
}

/** Sign in on a new machine with an existing phrase: same account, new device keys. */
export function loginIdentity(phrase: string, deviceName: string): LoadedIdentity {
  if (fs.existsSync(identityPath())) {
    throw new Error(`This machine already has an identity (${identityPath()}). Delete it first to re-login.`);
  }
  return enrollDevice(accountFromPhrase(phrase), deviceName);
}

function enrollDevice(account: AccountKeys, deviceName: string): LoadedIdentity {
  const deviceSign = randomSignKeypair();
  const deviceBox = randomBoxKeypair();
  const device = certifyDevice(account, deviceSign, deviceBox, deviceName);
  const file: IdentityFile = {
    v: 1,
    accountSignPub: toHex(account.sign.pub),
    accountEncPub: toHex(account.box.pub),
    fingerprint: account.fingerprint,
    device,
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(vortexHome(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(identityPath(), JSON.stringify(file, null, 2) + "\n");
  fs.writeFileSync(deviceKeyPath(), toHex(deviceSign.priv) + "\n" + toHex(deviceBox.priv) + "\n", { mode: 0o600 });
  return { file, deviceSign, deviceBox };
}

export function loadIdentity(): LoadedIdentity {
  if (!fs.existsSync(identityPath())) {
    throw new Error("No identity on this machine. Run: vortex-notes identity init (or 'identity login' with your phrase).");
  }
  const file = JSON.parse(fs.readFileSync(identityPath(), "utf8")) as IdentityFile;
  const [signHex, boxHex] = fs.readFileSync(deviceKeyPath(), "utf8").trim().split("\n");
  const deviceSign = signKeypairFromSeed(fromHex(signHex));
  const deviceBox = boxKeypairFromSeed(fromHex(boxHex));
  if (toHex(deviceSign.pub) !== file.device.signPub) {
    throw new Error("device.key does not match identity.json (corrupted state).");
  }
  if (!verifyDeviceCert(fromHex(file.accountSignPub), file.device)) {
    throw new Error("Device certificate signature is invalid.");
  }
  return { file, deviceSign, deviceBox };
}

export function hasIdentity(): boolean {
  return fs.existsSync(identityPath());
}
