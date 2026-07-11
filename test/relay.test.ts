import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startRelay } from "../src/relay/server.js";
import { RelayClient } from "../src/relay/client.js";
import { initIdentity, loginIdentity, accountFromPhrase } from "../src/identity.js";
import { createSpace, openSpaceKey, encryptDoc, decryptDoc } from "../src/spaces.js";
import { openBox, fromHex, randomSignKeypair, sign, toHex, utf8 } from "../src/crypto.js";

function freshHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-relay-"));
  process.env.VORTEX_NOTES_HOME = dir;
  return dir;
}

test("relay: two devices, one account — encrypted note round-trip, relay sees only ciphertext", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    // machine 1: create identity + space, push an encrypted note
    freshHome();
    const { phrase, identity: mac } = initIdentity("mac");
    const space = createSpace(mac, "personal");
    const key1 = openSpaceKey(mac, space);

    const c1 = new RelayClient(base, mac);
    await c1.register();
    await c1.createSpace(space);
    const secret = "# Milanesas plan\nSecret family recipe steps.";
    await c1.pushUpdate(space.id, "note-1", encryptDoc(key1, "note-1", secret));
    await c1.pushUpdate(space.id, "note-1", encryptDoc(key1, "note-1", secret + "\nEdited."));

    // machine 2: login with the phrase, discover the space, decrypt
    freshHome();
    const laptop = loginIdentity(phrase, "laptop");
    const c2 = new RelayClient(base, laptop);
    await c2.register();
    const remote = await c2.listSpaces();
    assert.equal(remote.length, 1);
    assert.equal(remote[0].id, space.id);

    // The space key travels sealed to the ACCOUNT key; the phrase unlocks it.
    const account = accountFromPhrase(phrase);
    const sealedForAccount = remote[0].sealedKeys[laptop.file.accountSignPub];
    assert.ok(sealedForAccount, "space key sealed to account present on relay");
    const key2 = openBox(fromHex(sealedForAccount), account.box);

    const updates = await c2.pullUpdates(space.id);
    assert.equal(updates.length, 2);
    assert.equal(decryptDoc(key2, "note-1", updates[1].blob), secret + "\nEdited.");
    assert.equal(updates[0].author, mac.file.device.signPub); // attribution

    // incremental pull
    const later = await c2.pullUpdates(space.id, updates[1].seq);
    assert.equal(later.length, 0);

    // what the relay stored is not plaintext
    const asText = Buffer.from(updates[0].blob).toString("utf8");
    assert.ok(!asText.includes("Milanesas"), "relay blob must not contain plaintext");
  } finally {
    await relay.close();
  }
});

test("relay auth: unregistered devices, bad signatures, foreign spaces are rejected", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    freshHome();
    const { identity: alice } = initIdentity("alice-mac");
    const aliceSpace = createSpace(alice, "alice-notes");
    const cAlice = new RelayClient(base, alice);
    await cAlice.register();
    await cAlice.createSpace(aliceSpace);

    // unregistered device
    freshHome();
    const { identity: mallory } = initIdentity("mallory-box");
    const cMallory = new RelayClient(base, mallory);
    await assert.rejects(cMallory.listSpaces(), /not registered/i);

    // registered but foreign account can't touch alice's space
    await cMallory.register();
    await assert.rejects(cMallory.pullUpdates(aliceSpace.id), /Not your space/);
    await assert.rejects(cMallory.pushUpdate(aliceSpace.id, "doc", new Uint8Array([1, 2, 3])), /Not your space/);

    // bad signature: sign with a key that isn't the registered device key
    const rogue = randomSignKeypair();
    const ts = String(Date.now());
    const res = await fetch(`${base}/v1/spaces`, {
      headers: {
        "x-vortex-device": mallory.file.device.signPub,
        "x-vortex-ts": ts,
        "x-vortex-sig": toHex(sign(utf8(`GET\n/v1/spaces\n${ts}\n0`), rogue.priv)),
      },
    });
    assert.equal(res.status, 401);

    // stale timestamp
    const old = String(Date.now() - 10 * 60 * 1000);
    const res2 = await fetch(`${base}/v1/spaces`, {
      headers: { "x-vortex-device": mallory.file.device.signPub, "x-vortex-ts": old, "x-vortex-sig": "00" },
    });
    assert.equal(res2.status, 401);
  } finally {
    await relay.close();
  }
});
