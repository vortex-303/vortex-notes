import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Vault } from "../src/vault.js";
import { startRelay } from "../src/relay/server.js";
import { initIdentity, loginIdentity } from "../src/identity.js";
import { linkVault, joinVault, syncVault } from "../src/sync.js";

process.env.VORTEX_NOTES_NO_SEMANTIC = "1";

// Identities live under VORTEX_NOTES_HOME; each simulated machine gets its own
// home dir and we re-point the env var while acting as that machine.
function newHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vortex-sync-home-"));
}
async function as<T>(home: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env.VORTEX_NOTES_HOME;
  process.env.VORTEX_NOTES_HOME = home;
  try {
    return await fn();
  } finally {
    process.env.VORTEX_NOTES_HOME = prev;
  }
}

function freshVault(): Vault {
  const vault = new Vault(fs.mkdtempSync(path.join(os.tmpdir(), "vortex-sync-vault-")));
  vault.init();
  fs.rmSync(vault.abs("Welcome.md")); // keep fixtures minimal
  return vault;
}

test("sync: link → push → join → pull → bidirectional edits", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const mac = newHome();
  const laptop = newHome();
  try {
    const v1 = freshVault();
    const v2 = freshVault();

    const phrase = await as(mac, async () => {
      const { phrase } = initIdentity("mac");
      v1.writeNote("ideas.md", "Ideas", "First idea: encrypted notes.");
      v1.writeNote("projects/plan.md", "Plan", "Ship slice 1c.");
      await linkVault(v1, base, "personal");
      const r = await syncVault(v1);
      assert.equal(r.pushed, 2);
      return phrase;
    });

    await as(laptop, async () => {
      loginIdentity(phrase, "laptop");
      await joinVault(v2, base, phrase);
      const r = await syncVault(v2);
      assert.equal(r.pulled, 2);
      assert.match(fs.readFileSync(v2.abs("projects/plan.md"), "utf8"), /Ship slice 1c/);

      // edit on laptop
      v2.updateNote("ideas.md", "First idea: encrypted notes.\nSecond idea: agents as members.");
      const r2 = await syncVault(v2);
      assert.equal(r2.pushed, 1);
    });

    await as(mac, async () => {
      const r = await syncVault(v1);
      assert.equal(r.pulled, 1);
      assert.match(fs.readFileSync(v1.abs("ideas.md"), "utf8"), /agents as members/);
      assert.equal(r.conflicts.length, 0);
    });

    // no-op sync is quiet
    await as(laptop, async () => {
      const r = await syncVault(v2);
      assert.equal(r.pulled + r.pushed, 0);
    });
  } finally {
    await relay.close();
  }
});

test("browser edit loop: an ephemeral browser device pushes; daemon sync writes the file", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const mac = newHome();
  try {
    const v1 = freshVault();
    await as(mac, async () => {
      const { phrase } = initIdentity("mac");
      v1.writeNote("ideas.md", "Ideas", "original");
      await linkVault(v1, base, "personal");
      await syncVault(v1);

      // simulate the /app browser: account from phrase, in-memory device
      const { accountFromPhrase, certifyDevice } = await import("../src/account.js");
      const { randomSignKeypair, randomBoxKeypair, toHex, fromHex, openBox, encryptPayload, utf8 } = await import(
        "../src/crypto.js"
      );
      const { RelayClient } = await import("../src/relay/client.js");
      const account = accountFromPhrase(phrase);
      const dSign = randomSignKeypair();
      const dBox = randomBoxKeypair();
      const browser = {
        file: {
          accountSignPub: toHex(account.sign.pub),
          accountEncPub: toHex(account.box.pub),
          device: certifyDevice(account, dSign, dBox, "browser@test"),
        },
        deviceSign: dSign,
        deviceBox: dBox,
      };
      const cB = new RelayClient(base, browser);
      await cB.register();
      const remote = await cB.listSpaces();
      const spaceKey = openBox(fromHex(remote[0].sealedKeys[browser.file.accountSignPub]), account.box);

      // browser edits ideas.md and creates a brand-new note
      const edited = { v: 1, path: "ideas.md", content: "edited in the browser", mtimeMs: Date.now() + 1000 };
      await cB.pushUpdate(remote[0].id, "ideas.md", encryptPayload(spaceKey, utf8(JSON.stringify(edited)), "vortex-doc-v1:ideas.md"));
      const fresh = { v: 1, path: "inbox/from-web.md", content: "# From the web\nhello", mtimeMs: Date.now() + 1000 };
      await cB.pushUpdate(remote[0].id, "inbox/from-web.md", encryptPayload(spaceKey, utf8(JSON.stringify(fresh)), "vortex-doc-v1:inbox/from-web.md"));

      // daemon-side sync (what autosync runs every 30s) materializes both
      const r = await syncVault(v1);
      assert.equal(r.pulled, 2);
      assert.equal(fs.readFileSync(v1.abs("ideas.md"), "utf8"), "edited in the browser");
      assert.match(fs.readFileSync(v1.abs("inbox/from-web.md"), "utf8"), /From the web/);
    });
  } finally {
    await relay.close();
  }
});

test("sync: concurrent edits to different parts of a note merge cleanly (diff3)", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const mac = newHome();
  const laptop = newHome();
  try {
    const v1 = freshVault();
    const v2 = freshVault();
    const original = "# Plan\n\nintro line\n\n## Tasks\n- task one\n\n## Notes\n- note one";

    const phrase = await as(mac, async () => {
      const { phrase } = initIdentity("mac");
      fs.writeFileSync(v1.abs("plan.md"), original);
      await linkVault(v1, base, "personal");
      await syncVault(v1);
      return phrase;
    });
    await as(laptop, async () => {
      loginIdentity(phrase, "laptop");
      await joinVault(v2, base, phrase);
      await syncVault(v2);
    });

    // mac edits the Tasks section; laptop edits the Notes section — no overlap
    await as(mac, async () => {
      fs.writeFileSync(v1.abs("plan.md"), original.replace("- task one", "- task one\n- task two (mac)"));
      await syncVault(v1);
    });
    await as(laptop, async () => {
      fs.writeFileSync(v2.abs("plan.md"), original.replace("- note one", "- note one\n- note two (laptop)"));
      const r = await syncVault(v2);
      assert.equal(r.conflicts.length, 0, "non-overlapping edits must not conflict");
      const merged = fs.readFileSync(v2.abs("plan.md"), "utf8");
      assert.match(merged, /task two \(mac\)/);
      assert.match(merged, /note two \(laptop\)/);
    });
    // mac pulls the merged result
    await as(mac, async () => {
      const r = await syncVault(v1);
      assert.equal(r.conflicts.length, 0);
      const merged = fs.readFileSync(v1.abs("plan.md"), "utf8");
      assert.match(merged, /task two \(mac\)/);
      assert.match(merged, /note two \(laptop\)/);
    });
  } finally {
    await relay.close();
  }
});

test("sync: concurrent edits produce a conflict file, newest wins in place", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const mac = newHome();
  const laptop = newHome();
  try {
    const v1 = freshVault();
    const v2 = freshVault();

    const phrase = await as(mac, async () => {
      const { phrase } = initIdentity("mac");
      v1.writeNote("shared.md", "Shared", "base version");
      await linkVault(v1, base, "personal");
      await syncVault(v1);
      return phrase;
    });

    await as(laptop, async () => {
      loginIdentity(phrase, "laptop");
      await joinVault(v2, base, phrase);
      await syncVault(v2);
    });

    // both edit without syncing; laptop edits LATER so it should win
    await as(mac, async () => {
      v1.updateNote("shared.md", "mac version");
      await syncVault(v1); // mac pushes first
    });
    await new Promise((r) => setTimeout(r, 20));
    await as(laptop, async () => {
      v2.updateNote("shared.md", "laptop version");
      const r = await syncVault(v2); // pull sees mac's edit, local is newer → conflict file + local wins
      assert.equal(r.conflicts.length, 1);
      assert.match(fs.readFileSync(v2.abs("shared.md"), "utf8"), /laptop version/);
      const conflict = fs.readFileSync(v2.abs(r.conflicts[0]), "utf8");
      assert.match(conflict, /mac version/);
    });

    // mac pulls: gets laptop's winning version (its own words survive in laptop's conflict file)
    await as(mac, async () => {
      const r = await syncVault(v1);
      assert.ok(r.pulled >= 1);
      assert.match(fs.readFileSync(v1.abs("shared.md"), "utf8"), /laptop version/);
    });
  } finally {
    await relay.close();
  }
});
