import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  sealBox,
  openBox,
  randomBoxKeypair,
  randomKey,
  encryptPayload,
  decryptPayload,
  utf8,
  toHex,
} from "../src/crypto.js";
import {
  generatePhrase,
  accountFromPhrase,
  initIdentity,
  loginIdentity,
  loadIdentity,
  verifyDeviceCert,
} from "../src/identity.js";
import { createSpace, getSpace, openSpaceKey, grantSpace, encryptDoc, decryptDoc, listSpaces } from "../src/spaces.js";
import { fromHex } from "../src/crypto.js";

function freshHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-id-"));
  process.env.VORTEX_NOTES_HOME = dir;
  return dir;
}

test("same phrase derives the same account on any machine", () => {
  const phrase = generatePhrase();
  const a = accountFromPhrase(phrase);
  const b = accountFromPhrase("  " + phrase.toUpperCase() + " \n"); // normalization
  assert.equal(toHex(a.sign.pub), toHex(b.sign.pub));
  assert.equal(toHex(a.box.pub), toHex(b.box.pub));
  assert.equal(a.fingerprint, b.fingerprint);
  const other = accountFromPhrase(generatePhrase());
  assert.notEqual(toHex(a.sign.pub), toHex(other.sign.pub));
});

test("invalid phrase is rejected", () => {
  assert.throws(() => accountFromPhrase("potato potato potato"), /valid recovery phrase/);
});

test("sealed box: only the recipient opens it; tampering fails", () => {
  const recipient = randomBoxKeypair();
  const stranger = randomBoxKeypair();
  const sealed = sealBox(utf8("space key material"), recipient.pub);
  assert.equal(new TextDecoder().decode(openBox(sealed, recipient)), "space key material");
  assert.throws(() => openBox(sealed, stranger));
  const tampered = new Uint8Array(sealed);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => openBox(tampered, recipient));
});

test("payload encryption binds AAD context", () => {
  const key = randomKey();
  const blob = encryptPayload(key, utf8("hello"), "doc-1");
  assert.equal(new TextDecoder().decode(decryptPayload(key, blob, "doc-1")), "hello");
  assert.throws(() => decryptPayload(key, blob, "doc-2")); // swapped context fails
});

test("identity init → load roundtrip, cert verifies", () => {
  freshHome();
  const { phrase, identity } = initIdentity("test-mac");
  assert.equal(phrase.split(" ").length, 12);
  const loaded = loadIdentity();
  assert.equal(loaded.file.fingerprint, identity.file.fingerprint);
  assert.ok(verifyDeviceCert(fromHex(loaded.file.accountSignPub), loaded.file.device));
  assert.throws(() => initIdentity("again"), /already exists/);
});

test("login with phrase on a 'new machine': same account, new device", () => {
  freshHome();
  const { phrase, identity: first } = initIdentity("machine-1");
  freshHome(); // simulate a different machine
  const second = loginIdentity(phrase, "machine-2");
  assert.equal(second.file.fingerprint, first.file.fingerprint);
  assert.equal(second.file.accountSignPub, first.file.accountSignPub);
  assert.notEqual(second.file.device.signPub, first.file.device.signPub);
  assert.ok(verifyDeviceCert(fromHex(second.file.accountSignPub), second.file.device));
});

test("space: create, unlock with device key, encrypt/decrypt docs, grant", () => {
  freshHome();
  const { identity } = initIdentity("mac");
  const space = createSpace(identity, "work");
  assert.equal(getSpace("work").id, space.id);
  assert.equal(listSpaces().length, 1);

  const key = openSpaceKey(identity, space);
  const blob = encryptDoc(key, "note-abc", "# Secret plan\nhello");
  assert.equal(decryptDoc(key, "note-abc", blob), "# Secret plan\nhello");
  assert.throws(() => decryptDoc(key, "note-xyz", blob)); // AAD binds doc id

  // Grant to a new principal (e.g. an agent): it can open the key, a stranger can't.
  const agent = randomBoxKeypair();
  grantSpace(space, key, "agent-hermes", agent.pub);
  const refreshed = getSpace("work");
  const sealedForAgent = refreshed.sealedKeys["agent-hermes"];
  assert.ok(sealedForAgent);
  const agentKey = openBox(fromHex(sealedForAgent), agent);
  assert.equal(decryptDoc(agentKey, "note-abc", blob), "# Secret plan\nhello");
});
