import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Vault, slugify } from "../src/vault.js";
import { Indexer, chunkMarkdown, extractWikilinks } from "../src/indexer.js";
import { search } from "../src/search.js";
import { buildContext } from "../src/context.js";

process.env.VORTEX_NOTES_NO_SEMANTIC = "1"; // keyword-only in tests (no model download)

function tmpVault(): Vault {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-test-"));
  const vault = new Vault(dir);
  vault.init();
  return vault;
}

test("vault init creates skeleton", () => {
  const vault = tmpVault();
  assert.ok(fs.existsSync(vault.configPath));
  assert.ok(fs.existsSync(vault.abs("Welcome.md")));
  assert.ok(fs.existsSync(vault.abs("daily")));
});

test("write/read note round-trip with frontmatter", () => {
  const vault = tmpVault();
  vault.writeNote("projects/idea.md", "Big Idea", "Some **bold** thought.", ["ideas"]);
  const note = vault.readNote("projects/idea.md");
  assert.equal(note.title, "Big Idea");
  assert.deepEqual(note.tags, ["ideas"]);
  assert.match(note.body, /bold/);
  assert.ok(note.frontmatter.id);
});

test("path escapes are rejected", () => {
  const vault = tmpVault();
  assert.throws(() => vault.abs("../outside.md"));
  assert.throws(() => vault.abs("/etc/passwd"));
});

test("append_daily creates and appends", () => {
  const vault = tmpVault();
  const rel = vault.appendDaily("first entry");
  const rel2 = vault.appendDaily("second entry");
  assert.equal(rel, rel2);
  const note = vault.readNote(rel);
  assert.match(note.body, /first entry/);
  assert.match(note.body, /second entry/);
});

test("chunkMarkdown carries heading context and splits long bodies", () => {
  const chunks = chunkMarkdown(`# Alpha\n\npara one\n\n## Beta\n\n${"x".repeat(3000)}\n\ntail`);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].heading, "Alpha");
  assert.ok(chunks.some((c) => c.heading === "Beta"));
});

test("index + keyword search finds notes, removes deleted", async () => {
  const vault = tmpVault();
  vault.writeNote("cooking.md", "Cooking", "Recipe for chimichurri sauce with parsley and garlic.");
  vault.writeNote("infra.md", "Infra", "Deploy the relay server on Fly.io with WireGuard.");
  const indexer = new Indexer(vault);
  const r = await indexer.indexAll();
  assert.ok(r.total >= 3); // includes Welcome.md

  const hits = await search(indexer, "chimichurri parsley", 5, "keyword");
  assert.equal(hits[0].path, "cooking.md");

  fs.rmSync(vault.abs("cooking.md"));
  const r2 = await indexer.indexAll();
  assert.equal(r2.removed, 1);
  const hits2 = await search(indexer, "chimichurri", 5, "keyword");
  assert.ok(!hits2.some((h) => h.path === "cooking.md"));
  indexer.close();
});

test("reindexing a changed note updates search", async () => {
  const vault = tmpVault();
  vault.writeNote("a.md", "A", "original topic: astronomy");
  const indexer = new Indexer(vault);
  await indexer.indexAll();
  vault.updateNote("a.md", "new topic: volcanoes and lava");
  indexer.indexNote("a.md");
  const hits = await search(indexer, "volcanoes", 5, "keyword");
  assert.equal(hits[0]?.path, "a.md");
  const stale = await search(indexer, "astronomy", 5, "keyword");
  assert.ok(!stale.some((h) => h.path === "a.md"));
  indexer.close();
});

test("extractWikilinks handles aliases, headings, dedup", () => {
  const links = extractWikilinks(
    "See [[Alpha]] and [[Beta|the beta note]] and [[Gamma#section]] and [[Alpha]] again. Not a link: [x]."
  );
  assert.deepEqual(links.sort(), ["Alpha", "Beta", "Gamma"]);
});

test("rememberFact records and supersedes with visible history", () => {
  const vault = tmpVault();
  const r1 = vault.rememberFact("Relay runs on port 4000");
  const r2 = vault.rememberFact("Relay runs on port 5000", undefined, r1.id);
  assert.equal(r2.superseded, r1.id);
  const body = vault.readNote(r1.rel).body;
  assert.match(body, /~~.*port 4000.*~~/);
  assert.match(body, new RegExp(`superseded \\d{4}-\\d{2}-\\d{2} by \`\\^${r2.id}\``));
  // supersede by substring
  const r3 = vault.rememberFact("Relay moved to Fly.io", undefined, "port 5000");
  assert.equal(r3.superseded, r2.id);
  // superseding an already-dead fact fails
  assert.throws(() => vault.rememberFact("nope", undefined, r1.id), /already superseded/);
  // topic goes to its own file
  const t = vault.rememberFact("Prefers dark mode", "user-prefs");
  assert.equal(t.rel, "memory/user-prefs.md");
});

test("buildContext includes primaries, outgoing links, and backlinks", async () => {
  const vault = tmpVault();
  vault.writeNote("wombats.md", "Wombat Research", "Wombats dig burrows. Methodology in [[Field Protocol]].");
  vault.writeNote("field-protocol.md", "Field Protocol", "Count burrows at dawn.");
  vault.writeNote("funding.md", "Funding", "Grant covers [[Wombat Research]] until 2027.");
  const indexer = new Indexer(vault);
  await indexer.indexAll();
  const ctx = await buildContext(indexer, "wombat burrows", 1);
  assert.match(ctx, /Wombats dig burrows/); // primary, full content
  assert.match(ctx, /field-protocol\.md/); // outgoing link
  assert.match(ctx, /funding\.md/); // backlink
  indexer.close();
});

test("slugify handles accents and junk", () => {
  assert.equal(slugify("Cómo están ustedes?"), "como-estan-ustedes");
  assert.equal(slugify("  ---  "), "note");
});
