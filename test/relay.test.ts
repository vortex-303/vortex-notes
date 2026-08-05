import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startRelay } from "../src/relay/server.js";
import { RelayClient } from "../src/relay/client.js";
import { initIdentity, loginIdentity, accountFromPhrase } from "../src/identity.js";
import { createSpace, openSpaceKey, encryptDoc, decryptDoc } from "../src/spaces.js";
import { openBox, sealBox, fromHex, randomSignKeypair, sign, toHex, utf8 } from "../src/crypto.js";

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

test("public notes: publish, themed page, stable slug on update, unpublish, scoping", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    freshHome();
    const { identity } = initIdentity("mac");
    const c = new RelayClient(base, identity);
    await c.register();

    const slug = await c.publishNote({
      path: "poetry/decada.md",
      title: "La Próxima Década",
      author: "Nico",
      theme: "manuscript",
      markdown: "# La Próxima Década\n\nLa pantalla aún brilla.\n\n<script>alert(1)</script>",
    });
    assert.match(slug, /^la-proxima-decada-[a-z0-9]{4}$/);

    const page = await fetch(`${base}/p/${slug}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /La pantalla aún brilla/);
    assert.match(html, /Nico/);
    assert.match(html, /Written in/);
    assert.ok(!html.includes("<script>alert"), "script tags stripped");
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);

    // update re-uses the same slug (stable public links)
    const slug2 = await c.publishNote({
      slug,
      path: "poetry/decada.md",
      title: "La Próxima Década",
      author: null,
      theme: "vortex",
      markdown: "updated body",
    });
    assert.equal(slug2, slug);
    const html2 = await (await fetch(`${base}/p/${slug}`)).text();
    assert.match(html2, /updated body/);
    assert.match(html2, /Anonymous/);
    assert.match(html2, /watermark/); // vortex theme applied

    // listing + unpublish
    assert.equal((await c.listPublic()).length, 1);
    await c.unpublishNote(slug);
    assert.equal((await fetch(`${base}/p/${slug}`)).status, 404);

    // another account can't touch someone else's slug
    freshHome();
    const { identity: other } = initIdentity("other");
    const c2 = new RelayClient(base, other);
    await c2.register();
    const slug3 = await c2.publishNote({ path: "x.md", title: "Mine", author: null, theme: "typewriter", markdown: "hi" });
    freshHome();
    const { identity: third } = initIdentity("third");
    const c3 = new RelayClient(base, third);
    await c3.register();
    await assert.rejects(c3.unpublishNote(slug3), /Not your public note/);
    await assert.rejects(
      c3.publishNote({ slug: slug3, path: "y.md", title: "Steal", author: null, theme: "vortex", markdown: "x" }),
      /Not your public note/
    );
  } finally {
    await relay.close();
  }
});

test("admin stats: only the configured account can read them", async () => {
  freshHome();
  const { identity: admin } = initIdentity("admin-mac");
  // comma-separated list with sloppy spacing — any listed account is admin
  const relay = await startRelay({ port: 0, adminAccount: ` ${"ab".repeat(32)}, ${admin.file.accountSignPub} ` });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    const cAdmin = new RelayClient(base, admin);
    await cAdmin.register();
    const space = createSpace(admin, "s");
    await cAdmin.createSpace(space);
    const key = openSpaceKey(admin, space);
    await cAdmin.pushUpdate(space.id, "a.md", encryptDoc(key, "a.md", "hello"));

    const stats = (await cAdmin.getAdminStats()) as Record<string, number>;
    assert.equal(stats.accounts, 1);
    assert.equal(stats.updatesTotal, 1);
    assert.ok(stats.bytesStored > 0);

    // another account is refused — stats, accounts list, and tagging alike
    freshHome();
    const { identity: other } = initIdentity("other");
    const cOther = new RelayClient(base, other);
    await cOther.register();
    await assert.rejects(cOther.getAdminStats(), /Not an admin/);
    await assert.rejects(cOther.getAdminAccounts(), /Not an admin/);
    await assert.rejects(cOther.setAdminTag(admin.file.accountSignPub, "test"), /Not an admin/);

    // accounts listing: both accounts, with device names and activity
    const rows = await cAdmin.getAdminAccounts();
    assert.equal(rows.length, 2);
    const adminRow = rows.find((r) => r.account === admin.file.accountSignPub)!;
    assert.equal(adminRow.principals[0].name, "admin-mac");
    assert.equal(adminRow.updates, 1);
    assert.ok(adminRow.lastActive);
    assert.equal(adminRow.tag, null);

    // tagging: untagged count drops, tag round-trips, clearing restores it
    assert.equal((await cAdmin.getAdminStats()).newAccounts, 2);
    await cAdmin.setAdminTag(admin.file.accountSignPub, "mine");
    await cAdmin.setAdminTag(other.file.accountSignPub, "test");
    assert.equal((await cAdmin.getAdminStats()).newAccounts, 0);
    const tagged = await cAdmin.getAdminAccounts();
    assert.equal(tagged.find((r) => r.account === other.file.accountSignPub)!.tag, "test");
    await cAdmin.setAdminTag(other.file.accountSignPub, null);
    assert.equal((await cAdmin.getAdminStats()).newAccounts, 1);

    // relay without adminAccount refuses everyone
    const bare = await startRelay({ port: 0 });
    try {
      const cBare = new RelayClient(`http://127.0.0.1:${bare.port}`, admin);
      await cBare.register();
      await assert.rejects(cBare.getAdminStats(), /Not an admin/);
    } finally {
      await bare.close();
    }
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

test("space transfer: re-keys ownership, members keep access", async () => {
  freshHome();
  const { identity: alice } = initIdentity("alice-mac");
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    const cAlice = new RelayClient(base, alice);
    await cAlice.register();
    const space = createSpace(alice, "s");
    await cAlice.createSpace(space);
    const key = openSpaceKey(alice, space);
    await cAlice.pushUpdate(space.id, "a.md", encryptDoc(key, "a.md", "hello"));

    // a second account (the "new words" identity)
    freshHome();
    const { identity: nova } = initIdentity("nova-web");
    const cNova = new RelayClient(base, nova);
    await cNova.register();

    // a stranger can't transfer someone else's space
    await assert.rejects(cNova.transferSpace(space.id, nova.file.accountSignPub), /Not your space/);
    // and the target must exist
    await assert.rejects(cAlice.transferSpace(space.id, "ab".repeat(32)), /no registered devices/);

    // re-seal to nova (account + device) minus alice's account, then transfer
    const sp = (await cAlice.listSpaces()).find((s) => s.id === space.id)!;
    const sealedKeys = { ...sp.sealedKeys };
    delete sealedKeys[alice.file.accountSignPub];
    sealedKeys[nova.file.accountSignPub] = toHex(sealBox(key, fromHex(nova.file.accountEncPub)));
    sealedKeys[nova.file.device.signPub] = toHex(sealBox(key, nova.deviceBox.pub));
    await cAlice.createSpace({ id: sp.id, name: sp.id, createdAt: sp.createdAt, sealedKeys });
    await cAlice.transferSpace(space.id, nova.file.accountSignPub);

    // nova owns it now: lists it, reads it, writes to it
    const novaSpaces = await cNova.listSpaces();
    assert.equal(novaSpaces.length, 1);
    const pulled = await cNova.pullUpdates(space.id);
    assert.ok(pulled.length >= 1);
    await cNova.pushUpdate(space.id, "b.md", encryptDoc(key, "b.md", "from nova"));

    // alice's DEVICE is still sealed in → still a member, still works
    const aliceSpaces = await cAlice.listSpaces();
    assert.equal(aliceSpaces.length, 1, "old device keeps membership via its seal");
    await cAlice.pushUpdate(space.id, "c.md", encryptDoc(key, "c.md", "old device writes"));
  } finally {
    await relay.close();
  }
});

test("live sync: signed subscribers get 'changed' pokes; non-members are refused", async () => {
  const { WebSocket } = await import("ws");
  freshHome();
  const { phrase, identity: owner } = initIdentity("phone");
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const wsUrl = `ws://127.0.0.1:${relay.port}/ws`;
  try {
    const cOwner = new RelayClient(base, owner);
    await cOwner.register();
    const space = createSpace(owner, "s");
    await cOwner.createSpace(space);
    const key = openSpaceKey(owner, space);

    // a SECOND device on the same account — this is what pushes
    freshHome();
    const laptop = loginIdentity(phrase, "laptop");
    const cLaptop = new RelayClient(base, laptop);
    await cLaptop.register();

    // an unrelated account (non-member)
    freshHome();
    const { identity: stranger } = initIdentity("stranger");
    const cStranger = new RelayClient(base, stranger);
    await cStranger.register();

    const connect = (client: RelayClient): Promise<{ ws: import("ws").WebSocket; msgs: Record<string, unknown>[] }> =>
      new Promise((resolve) => {
        const ws = new WebSocket(wsUrl);
        const msgs: Record<string, unknown>[] = [];
        ws.on("message", (d: Buffer) => msgs.push(JSON.parse(d.toString())));
        ws.on("open", () => { ws.send(JSON.stringify(client.wsSubFrame([space.id]))); resolve({ ws, msgs }); });
      });

    const member = await connect(cOwner);
    const outsider = await connect(cStranger);
    await new Promise((r) => setTimeout(r, 150)); // let subscribe frames resolve

    // membership decisions
    assert.deepEqual(member.msgs.find((m) => m.type === "subscribed")?.spaces, [space.id]);
    assert.deepEqual(outsider.msgs.find((m) => m.type === "subscribed")?.spaces, [], "stranger granted nothing");

    // a push wakes the member with a content-free poke
    await cLaptop.pushUpdate(space.id, "a.md", encryptDoc(key, "a.md", "hello"));
    await new Promise((r) => setTimeout(r, 200));
    const poke = member.msgs.find((m) => m.type === "changed");
    assert.ok(poke, "member received a change poke");
    assert.equal(poke.space, space.id);
    assert.ok(typeof poke.seq === "number");
    assert.ok(!JSON.stringify(poke).includes("hello"), "poke carries no plaintext");
    assert.ok(!outsider.msgs.some((m) => m.type === "changed"), "stranger heard nothing");

    // a bad signature is rejected
    const bad = await new Promise<Record<string, unknown>[]>((resolve) => {
      const ws = new WebSocket(wsUrl);
      const msgs: Record<string, unknown>[] = [];
      ws.on("message", (d: Buffer) => msgs.push(JSON.parse(d.toString())));
      ws.on("open", () => {
        const f = cOwner.wsSubFrame([space.id]);
        f.sig = "00".repeat(64);
        ws.send(JSON.stringify(f));
        setTimeout(() => resolve(msgs), 150);
      });
    });
    assert.ok(bad.some((m) => m.type === "error"), "forged signature rejected");

    member.ws.close();
    outsider.ws.close();
  } finally {
    await relay.close();
  }
});

test("geo: signup country surfaces in admin; the IP is never stored", async () => {
  freshHome();
  const { identity: admin } = initIdentity("admin");
  const relay = await startRelay({ port: 0, adminAccount: admin.file.accountSignPub });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    const cAdmin = new RelayClient(base, admin);
    await cAdmin.register(); // localhost → null country

    // a second account registers as if from a US IP (Fly-Client-IP header)
    freshHome();
    const { identity: user } = initIdentity("user-us");
    await fetch(`${base}/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Fly-Client-IP": "8.8.8.8" },
      body: JSON.stringify({
        accountSignPub: user.file.accountSignPub,
        accountEncPub: user.file.accountEncPub,
        device: user.file.device,
      }),
    });

    const stats = (await cAdmin.getAdminStats()) as { byCountry: { country: string; n: number }[] };
    assert.ok(Array.isArray(stats.byCountry));
    assert.ok(stats.byCountry.find((c) => c.country === "US"), "US signup counted");

    const rows = await cAdmin.getAdminAccounts();
    const us = rows.find((r) => r.account === user.file.accountSignPub)!;
    assert.equal(us.country, "US");

    // the raw IP must appear nowhere the admin can read
    const dump = JSON.stringify(rows) + JSON.stringify(stats);
    assert.ok(!dump.includes("8.8.8.8"), "raw IP is never surfaced or stored");
  } finally {
    await relay.close();
  }
});
