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

test("browser-style unlock: ephemeral device from phrase alone (no filesystem) can read the space", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    // seed: a normal machine pushes a note
    freshHome();
    const { phrase, identity: mac } = initIdentity("mac");
    const space = createSpace(mac, "personal");
    const key = openSpaceKey(mac, space);
    const c1 = new RelayClient(base, mac);
    await c1.register();
    await c1.createSpace(space);
    await c1.pushUpdate(space.id, "note-1", encryptDoc(key, "note-1", "browser should read this"));

    // "browser": derive account from phrase, mint an uncertified-by-fs device in memory
    const { accountFromPhrase: fromPhrase, certifyDevice } = await import("../src/account.js");
    const { randomBoxKeypair: rBox, randomSignKeypair: rSign, toHex: hex } = await import("../src/crypto.js");
    const account = fromPhrase(phrase);
    const dSign = rSign();
    const dBox = rBox();
    const browserIdentity = {
      file: {
        accountSignPub: hex(account.sign.pub),
        accountEncPub: hex(account.box.pub),
        device: certifyDevice(account, dSign, dBox, "browser@test"),
      },
      deviceSign: dSign,
      deviceBox: dBox,
    };
    const cB = new RelayClient(base, browserIdentity);
    await cB.register();
    const remote = await cB.listSpaces();
    const spaceKey = openBox(fromHex(remote[0].sealedKeys[browserIdentity.file.accountSignPub]), account.box);
    const updates = await cB.pullUpdates(remote[0].id);
    assert.equal(decryptDoc(spaceKey, "note-1", updates[0].blob), "browser should read this");

    // the relay serves the app shell
    const shell = await fetch(`${base}/app`);
    assert.equal(shell.status, 200);
    assert.match(await shell.text(), /recovery phrase/i);
    const bundle = await fetch(`${base}/app/bundle.js`);
    assert.equal(bundle.status, 200); // built by npm run build
  } finally {
    await relay.close();
  }
});

test("web-first onboarding: account + space created browser-style, CLI machine joins and pulls", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    // "browser": everything from a generated phrase, zero filesystem
    const { generatePhrase, accountFromPhrase: fromPhrase, certifyDevice } = await import("../src/account.js");
    const { randomKey, sealBox, randomSignKeypair: rSign, randomBoxKeypair: rBox, toHex: hex } = await import("../src/crypto.js");
    const { ulid } = await import("ulid");
    const phrase = generatePhrase();
    const account = fromPhrase(phrase);
    const dSign = rSign();
    const dBox = rBox();
    const browser = {
      file: {
        accountSignPub: hex(account.sign.pub),
        accountEncPub: hex(account.box.pub),
        device: certifyDevice(account, dSign, dBox, "browser@onboarding"),
      },
      deviceSign: dSign,
      deviceBox: dBox,
    };
    const cB = new RelayClient(base, browser);
    await cB.register();
    const key = randomKey();
    const record = {
      id: "sp-" + ulid().toLowerCase(),
      name: "personal",
      createdAt: new Date().toISOString(),
      sealedKeys: {
        [browser.file.device.signPub]: hex(sealBox(key, dBox.pub)),
        [browser.file.accountSignPub]: hex(sealBox(key, account.box.pub)),
      },
    };
    await cB.createSpace(record);
    await cB.pushUpdate(
      record.id,
      "first.md",
      (await import("../src/crypto.js")).encryptPayload(
        key,
        (await import("../src/crypto.js")).utf8(
          JSON.stringify({ v: 1, path: "first.md", content: "# Born on the web\nhello", mtimeMs: Date.now() })
        ),
        "vortex-doc-v1:first.md"
      )
    );

    // CLI machine: login with the phrase, join, sync — note materializes
    freshHome();
    const { loginIdentity: login } = await import("../src/identity.js");
    const { joinVault, syncVault } = await import("../src/sync.js");
    const { Vault } = await import("../src/vault.js");
    const fsm = await import("node:fs");
    login(phrase, "cli-machine");
    const vault = new Vault(fsm.default.mkdtempSync(path.join(os.tmpdir(), "vortex-web-first-")));
    vault.init();
    await joinVault(vault, base, phrase);
    const r = await syncVault(vault);
    assert.ok(r.pulled >= 1);
    assert.match(fsm.default.readFileSync(vault.abs("first.md"), "utf8"), /Born on the web/);
  } finally {
    await relay.close();
  }
});

test("quota: pushes are rejected past the cap; usage endpoint reports", async () => {
  const relay = await startRelay({ port: 0, quotaBytes: 2000 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    freshHome();
    const { identity } = initIdentity("mac");
    const space = createSpace(identity, "tiny");
    const key = openSpaceKey(identity, space);
    const c = new RelayClient(base, identity);
    await c.register();
    await c.createSpace(space);

    // a ~1KB blob fits; the second one crosses 2000 bytes and is rejected
    const blob = encryptDoc(key, "a.md", "x".repeat(900));
    await c.pushUpdate(space.id, "a.md", blob);
    const usage = await c.getUsage();
    assert.ok(usage.bytesUsed > 900 && usage.quotaBytes === 2000);
    await assert.rejects(c.pushUpdate(space.id, "b.md", encryptDoc(key, "b.md", "y".repeat(1200))), /quota exceeded/i);

    // unlimited relay (no option) never rejects
    const free = await startRelay({ port: 0 });
    try {
      const cf = new RelayClient(`http://127.0.0.1:${free.port}`, identity);
      await cf.register();
      await cf.createSpace(space);
      await cf.pushUpdate(space.id, "big.md", encryptDoc(key, "big.md", "z".repeat(5000)));
      assert.equal((await cf.getUsage()).quotaBytes, null);
    } finally {
      await free.close();
    }
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
