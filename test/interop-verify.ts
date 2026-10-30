/**
 * Reverse interop check: open what the Swift port (ios/VortexKit) produced,
 * using the real TypeScript crypto. Run after `swift test` in ios/VortexKit:
 *
 *   npx tsx test/interop-verify.ts
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { openBox, decryptPayload, verify, fromHex, fromB64, toHex, utf8 } from "../src/crypto.js";
import { accountFromPhrase, verifyDeviceCert, type SignedCert } from "../src/account.js";
import { unlockContent, unlockContentWithAccount } from "../src/notelock.js";

const vec = JSON.parse(readFileSync(new URL("./vectors/interop.json", import.meta.url), "utf8"));
const out = JSON.parse(readFileSync(new URL("./vectors/swift-out.json", import.meta.url), "utf8"));
const account = accountFromPhrase(vec.phrase);
const spaceKey = fromHex(vec.sealed.spaceKey);

const cert = out.deviceCert as SignedCert;
assert.ok(verifyDeviceCert(account.sign.pub, cert), "Swift device cert verifies under the account key");

assert.deepEqual(openBox(fromHex(out.sealedToAccount), account.box), spaceKey, "Swift sealBox opens");

const doc = JSON.parse(new TextDecoder().decode(decryptPayload(spaceKey, fromB64(out.doc.blob), "vortex-doc-v1:" + out.doc.path)));
assert.equal(doc.v, 1);
assert.equal(doc.path, out.doc.path);
assert.match(doc.content, /Hola 🧀/);

const r = out.request;
const canonical = `${r.method}\n${r.pathWithQuery}\n${r.ts}\n${toHex(sha256(utf8(r.body)))}`;
assert.ok(verify(fromHex(r.sig), utf8(canonical), fromHex(r.device)), "Swift request signature verifies");
assert.match(r.pathWithQuery, /^\/v1\/spaces\/[a-z0-9-]+\/docs\/[A-Za-z0-9._%-]+$/, "doc id fits the relay route");
assert.equal(decodeURIComponent(r.pathWithQuery.split("/").pop()), out.doc.path);

const plainBody = vec.locks.plain.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^\n+/, "");
assert.equal(unlockContent(out.lockedV2, out.lockPassword)?.body, plainBody, "Swift v2 lock opens with password");
assert.equal(unlockContentWithAccount(out.lockedV2, account.box)?.body, plainBody, "Swift v2 lock opens with 12 words");
assert.equal(unlockContent(out.lockedV2, "wrong"), null);

console.log("interop-verify: Swift → TypeScript OK (cert, seal, doc, request sig, v2 lock)");
