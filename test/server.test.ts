import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Vault } from "../src/vault.js";
import { startWebServer } from "../src/server.js";

process.env.VORTEX_NOTES_NO_SEMANTIC = "1";

test("web server serves shell, notes, search, raw; blocks escapes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-web-"));
  const vault = new Vault(dir);
  vault.init();
  vault.writeNote("guide.md", "Field Guide", "Capybaras are semi-aquatic. See [[Welcome to Vortex Notes]].");
  fs.writeFileSync(path.join(dir, "photo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");

  const { port, close } = await startWebServer(vault, { port: 0 });
  const base = `http://127.0.0.1:${port}`;
  try {
    // wait for background index to include the note
    for (let i = 0; i < 50; i++) {
      const list = (await (await fetch(`${base}/api/notes`)).json()) as { path: string }[];
      if (list.some((n) => n.path === "guide.md")) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const shell = await fetch(base);
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get("content-security-policy") ?? "", /script-src 'nonce-/);
    assert.match(await shell.text(), /Vortex<\/span> Notes/);

    const note = (await (await fetch(`${base}/api/note?path=guide.md`)).json()) as {
      title: string;
      html: string;
    };
    assert.equal(note.title, "Field Guide");
    assert.match(note.html, /semi-aquatic/);
    assert.match(note.html, /class="wikilink"/); // resolved [[Welcome...]]
    assert.match(note.html, /#\/note\/Welcome\.md/);

    const hits = (await (await fetch(`${base}/api/search?q=capybaras`)).json()) as {
      path: string;
    }[];
    assert.equal(hits[0]?.path, "guide.md");

    const raw = await fetch(`${base}/raw/photo.svg`);
    assert.equal(raw.status, 200);
    assert.equal(raw.headers.get("content-type"), "image/svg+xml");

    const escape = await fetch(`${base}/raw/..%2F..%2Fetc%2Fpasswd`);
    assert.notEqual(escape.status, 200);

    const missing = await fetch(`${base}/api/note?path=nope.md`);
    assert.equal(missing.status, 404);
  } finally {
    await close();
  }
});
