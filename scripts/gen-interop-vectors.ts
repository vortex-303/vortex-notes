/**
 * Interop test vectors for second clients (the native iOS/macOS app in ios/).
 * Generated from the REAL TypeScript crypto so the Swift port is checked
 * against the code the relay, web app and CLI actually run.
 *
 *   npx tsx scripts/gen-interop-vectors.ts   → test/vectors/interop.json
 *
 * The reverse direction (Swift-made ciphertexts opened here) is
 * test/interop-verify.ts.
 */
import { writeFileSync } from "node:fs";
import { mnemonicToSeedSync } from "@scure/bip39";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  derive,
  signKeypairFromSeed,
  boxKeypairFromSeed,
  sign,
  sealBox,
  encryptPayload,
  toHex,
  toB64,
  utf8,
} from "../src/crypto.js";
import { accountFromPhrase, canonical, type DeviceCertPayload } from "../src/account.js";
import { lockContent } from "../src/notelock.js";
import { tryDiff3 } from "../src/sync.js";

const out = new URL("../test/vectors/interop.json", import.meta.url);

// A published BIP39 test mnemonic; the messy variant checks normalization.
const phrase = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const messyPhrase = "  Legal  WINNER thank year wave sausage\tworth useful legal winner thank YELLOW \n";
const account = accountFromPhrase(phrase);
const seed = mnemonicToSeedSync(phrase);

// Fixed device keys so cert bytes and signatures are reproducible.
const deviceSign = signKeypairFromSeed(sha256(utf8("vortex-interop-device-sign")));
const deviceBox = boxKeypairFromSeed(sha256(utf8("vortex-interop-device-box")));

function signedCert(payload: DeviceCertPayload, signerPriv: Uint8Array) {
  const bytes = canonical(payload as unknown as Record<string, unknown>);
  return {
    payload,
    canonical: new TextDecoder().decode(bytes),
    certSig: toHex(sign(bytes, signerPriv)),
  };
}

const deviceCert = signedCert(
  {
    v: 1,
    kind: "device",
    signPub: toHex(deviceSign.pub),
    encPub: toHex(deviceBox.pub),
    name: "iPhone · iOS \"test\" é/€",
    createdAt: "2026-10-29T12:34:56.789Z",
  },
  account.sign.priv
);

const agentSign = signKeypairFromSeed(sha256(utf8("vortex-interop-agent-sign")));
const agentBox = boxKeypairFromSeed(sha256(utf8("vortex-interop-agent-box")));
const agentCert = signedCert(
  {
    v: 1,
    kind: "agent",
    signPub: toHex(agentSign.pub),
    encPub: toHex(agentBox.pub),
    name: "Claude",
    createdAt: "2026-10-29T12:00:00.000Z",
    spaces: ["sp-01jaaaaaaaaaaaaaaaaaaaaaaa"],
    mode: "rw",
    signedBy: toHex(deviceSign.pub),
  },
  deviceSign.priv
);

// Request signing: doc ids are percent-encoded as ONE segment, strictly
// (everything outside [A-Za-z0-9._-]), because the relay route only admits
// [A-Za-z0-9._%-]. JS encodeURIComponent would leave ~!'()* bare and 404.
function strictEncode(s: string): string {
  return Array.from(utf8(s))
    .map((b) => {
      const c = String.fromCharCode(b);
      return /[A-Za-z0-9._-]/.test(c) ? c : "%" + b.toString(16).toUpperCase().padStart(2, "0");
    })
    .join("");
}
const spaceId = "sp-01jaaaaaaaaaaaaaaaaaaaaaaa";
const docPaths = ["daily/2026-10-29.md", "Recetas/Milanesa ñ café (v2) ~!'*.md", "a b+c&d=e?.md"];
const doc0 = docPaths[1];
const body = JSON.stringify({ blob: "AAAA" });
const ts = "1761741296789";
const pathWithQuery = `/v1/spaces/${spaceId}/docs/${strictEncode(doc0)}`;
const requestCanonical = `POST\n${pathWithQuery}\n${ts}\n${toHex(sha256(utf8(body)))}`;
const getPath = `/v1/spaces/${spaceId}?since=0`;
const getCanonical = `GET\n${getPath}\n${ts}\n${toHex(sha256(new Uint8Array(0)))}`;
const wsSpaces = ["sp-b", "sp-a"];
const wsCanonical = `WS-SUB\n${ts}\n${toHex(sha256(utf8([...wsSpaces].sort().join(","))))}`;

// Space key sealed to the account (what sealedKeys[accountSignPub] holds) and to the device.
const spaceKey = sha256(utf8("vortex-interop-space-key"));
const docPayload = {
  v: 1,
  path: doc0,
  content: "---\ntitle: Milanesa\ntags:\n  - cooking\n---\n\n# Milanesa ñ\n\nBreaded meat with cheese 🧀.\n",
  mtimeMs: 1761741296789,
};
const tombstone = { v: 1, path: "old.md", content: "", mtimeMs: 1761741296790, deleted: true };

const plainNote = "---\ntitle: Secret\ncreated: '2026-10-29T00:00:00.000Z'\n---\n\nThe vault code is 0069.\nSecond line ñ.\n";
const password = "correct horse ñ 🐎";

// diff3: hand-written cases plus seeded random edits, merged by the CLI's tryDiff3.
const mergeCases: { base: string; local: string; remote: string }[] = [
  { base: "a\nb\nc", local: "a\nB\nc", remote: "a\nb\nC" },
  { base: "a\nb\nc", local: "a\nX\nc", remote: "a\nY\nc" },
  { base: "a\nb\nc", local: "a\nX\nc", remote: "a\nX\nc" },
  { base: "", local: "new local", remote: "" },
  { base: "", local: "x", remote: "y" },
  { base: "a\nb", local: "a\nb\n- **09:00** one", remote: "a\nb\n- **09:05** two" },
  { base: "title\n\nbody\n", local: "title\n\nbody\nmore\n", remote: "TITLE\n\nbody\n" },
  { base: "a\nb\nc\nd", local: "a\nc\nd", remote: "a\nb\nc" },
];
let rng = 0x5eed;
const rand = (n: number) => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff), rng % n);
const words = ["alpha", "beta", "gamma", "", "delta", "- [ ] todo", "# H", "ñandú 🧀"];
function mutate(lines: string[]): string[] {
  const out = [...lines];
  for (let k = rand(4); k >= 0; k--) {
    const op = rand(3), at = rand(out.length + 1);
    if (op === 0) out.splice(at, 0, words[rand(words.length)]);
    else if (op === 1 && out.length) out.splice(Math.min(at, out.length - 1), 1);
    else if (out.length) out[Math.min(at, out.length - 1)] = words[rand(words.length)];
  }
  return out;
}
for (let n = 0; n < 400; n++) {
  const base = Array.from({ length: rand(12) }, () => words[rand(words.length)]);
  mergeCases.push({ base: base.join("\n"), local: mutate(base).join("\n"), remote: mutate(base).join("\n") });
}
const merges = mergeCases.map((c) => ({ ...c, merged: tryDiff3(c.base, c.local, c.remote) }));

const vectors = {
  generatedBy: "scripts/gen-interop-vectors.ts",
  phrase,
  messyPhrase,
  invalidPhrase: "legal winner thank year wave sausage worth useful legal winner thank thank",
  seed: toHex(seed),
  account: {
    signPriv: toHex(account.sign.priv),
    signPub: toHex(account.sign.pub),
    boxPriv: toHex(account.box.priv),
    boxPub: toHex(account.box.pub),
    fingerprint: account.fingerprint,
  },
  hkdf: { ikm: toHex(utf8("ikm")), info: "vortex-test-info", out: toHex(derive(utf8("ikm"), "vortex-test-info")) },
  device: {
    signPriv: toHex(deviceSign.priv),
    signPub: toHex(deviceSign.pub),
    boxPriv: toHex(deviceBox.priv),
    boxPub: toHex(deviceBox.pub),
    cert: deviceCert,
  },
  agent: { cert: agentCert },
  request: {
    spaceId,
    docPaths: docPaths.map((p) => ({ path: p, encoded: strictEncode(p) })),
    post: { method: "POST", pathWithQuery, ts, body, canonical: requestCanonical, sig: toHex(sign(utf8(requestCanonical), deviceSign.priv)) },
    get: { method: "GET", pathWithQuery: getPath, ts, body: "", canonical: getCanonical },
    ws: { spaces: wsSpaces, ts, canonical: wsCanonical },
  },
  sealed: {
    spaceKey: toHex(spaceKey),
    toAccount: toHex(sealBox(spaceKey, account.box.pub)),
    toDevice: toHex(sealBox(spaceKey, deviceBox.pub)),
  },
  docs: [docPayload, tombstone].map((p) => ({
    payload: p,
    json: JSON.stringify(p),
    aad: "vortex-doc-v1:" + p.path,
    blob: toB64(encryptPayload(spaceKey, utf8(JSON.stringify(p)), "vortex-doc-v1:" + p.path)),
  })),
  merges,
  locks: {
    password,
    plain: plainNote,
    v2: lockContent(plainNote, password, account.box.pub),
    v1: lockContent(plainNote, password),
  },
};

writeFileSync(out, JSON.stringify(vectors, null, 2) + "\n");
console.log(`wrote ${out.pathname}`);
