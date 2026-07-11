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
