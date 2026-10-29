// Browser E2E for the rich (Apple-Notes-style) editor: notes open rendered with
// no markdown symbols, you type into the formatted text, the stored file stays
// markdown, untouched notes are never re-saved, and ⋯ → Edit markdown shows
// the source. A note the rich view can't keep exactly opens as markdown.
// SHOTS=<dir> saves screenshots.
import { chromium } from "playwright";
import { relayTarget } from "./relay-target.mjs";

const relay = await relayTarget();
const base = relay.base;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept("Corpus"));
let failed = false;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; };
let rpcId = 0;
const rpc = async (url, method, params = {}) =>
  (await (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) })).json());
const call = async (url, name, args) => (await rpc(url, "tools/call", { name, arguments: args })).result?.content?.[0]?.text ?? "";
const writes = [];
page.on("request", (r) => { if (r.method() !== "GET" && /\/v1\/spaces\/[^/]+\/docs\//.test(r.url())) writes.push(r.url()); });
const rich = "#editor.rich .ProseMirror";

const CORPUS = `Intro with **bold**, *italic*, ~~gone~~ and \`code\`. See [[Clay notes]] and [the site](https://example.com).

Dashboard: http://z270x.local:19999 · folder link [[lab/kiln-shed]]

## Firing

- cone 6
- slow cool
  - overnight

1. load
2. fire

- [ ] order shelves
- [x] buy clay

> Measure twice.

\`\`\`
temp = 1222
\`\`\`

| Cone | °C |
| --- | --- |
| 6 | 1222 |
`;

try {
  await page.goto(`${base}/app`);
  await page.click("#showCreateBtn");
  await page.waitForSelector("#newPhrase:not(:empty)");
  await page.check("#savedCheck");
  await page.click("#createBtn");
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });

  // an agent writes the notes (through a chat connector), as agents do
  await page.click("#userBtn");
  await page.click("#agentsBtn");
  await page.click("#chatBtn");
  await page.fill("#chatName", "Writer");
  await page.click("#chatCreate");
  await page.waitForSelector("#chatStep2:not([hidden])", { timeout: 15000 });
  const url = (await page.textContent("#chatUrl")).trim();
  await page.click("#chatClose");
  await page.keyboard.press("Escape");
  await call(url, "write_note", { title: "Kiln", content: CORPUS });
  await call(url, "write_note", { title: "Clay notes", content: "B-mix stoneware." });
  await call(url, "write_note", { title: "kiln-shed", folder: "lab", content: "The shed." });
  await call(url, "write_note", { title: "Styled", content: "Intro line.\n\n* alpha\n* beta\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\nLast para." });
  await call(url, "write_note", { title: "Live", content: "First paragraph.\n\nSecond paragraph." });
  await call(url, "write_note", { title: "Raw html", content: "Before<div align=\"center\">centered</div>\n\nAfter[^1]\n\n[^1]: a footnote" });
  await page.reload();
  await page.waitForSelector("#main", { state: "visible", timeout: 15000 });
  await page.waitForSelector('.noteitem, [data-path="kiln.md"], a[data-path]', { timeout: 15000 }).catch(() => {});

  const open = async (path) => {
    await page.click(`[data-path="${path}"]`);
    await page.waitForSelector("#editor", { timeout: 10000 });
  };
  const stored = async (path) => call(url, "read_note", { path });

  // 1. renders, no markdown symbols
  writes.length = 0;
  await open("kiln.md");
  await page.waitForSelector(rich, { timeout: 10000 });
  const text = await page.textContent(rich);
  check("opens in the rich editor", await page.isVisible(rich));
  check("no raw markdown symbols visible", !/\*\*|~~|\[\[|- \[ \]|^#|```|\| ---/m.test(text));
  check("heading renders as a heading", (await page.locator(`${rich} h2`).count()) === 1);
  check("checklist renders real checkboxes", (await page.locator(`${rich} ul[data-type="taskList"] input[type=checkbox]`).count()) === 2);
  check("table renders", (await page.locator(`${rich} table td`).count()) >= 2);
  check("wikilink renders as a link", (await page.locator(`${rich} a.wikilink[data-wikilink="Clay notes"]`).textContent()) === "Clay notes");
  check("Aa button is shown", await page.isVisible("#aaBtn"));
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/rich-desktop.png`, fullPage: true });

  check("bare URL renders as a link", (await page.locator(`${rich} a[href="http://z270x.local:19999"]`).count()) === 1);
  const [tab] = await Promise.all([ctx.waitForEvent("page", { timeout: 3000 }).catch(() => null), page.click(`${rich} a[href="http://z270x.local:19999"]`)]);
  check("clicking a bare URL opens it in a new tab (no edit mode needed)", !!tab && tab.url().startsWith("http://z270x.local:19999"));
  await tab?.close();
  await page.click(`${rich} a[data-wikilink="lab/kiln-shed"]`);
  await page.waitForFunction(() => /kiln-shed/.test(document.querySelector(".notehead h1")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
  check("folder wikilink [[lab/kiln-shed]] opens that note", /kiln-shed/.test(await page.textContent(".notehead h1")));
  await open("kiln.md");

  // 2. untouched note → no save on close
  await page.click('[data-path="clay-notes.md"]');
  await page.waitForTimeout(800);
  check("opening and leaving an untouched note saves nothing", writes.length === 0);
  if (writes.length) console.log("   writes:", writes.map((u) => decodeURIComponent(u.split("/docs/")[1])));

  // 3. wikilink opens the note
  await open("kiln.md");
  await page.click(`${rich} a.wikilink[data-wikilink="Clay notes"]`);
  await page.waitForFunction(() => /Clay notes/.test(document.querySelector(".notehead h1")?.textContent ?? ""), null, { timeout: 5000 });
  check("clicking a wikilink opens that note", true);

  // 4. typing into rendered text keeps the markdown structure
  await open("kiln.md");
  await page.click(`${rich} h2`);
  await page.keyboard.press("End");
  await page.keyboard.type(" schedule");
  await page.locator(`${rich} ul[data-type="taskList"] input[type=checkbox]`).first().click();
  await page.waitForTimeout(2200);
  const after = await stored("kiln.md");
  check("edit saved as markdown heading", /## Firing schedule/.test(after));
  check("checkbox click stored as - [x]", /- \[x\] order shelves/.test(after));
  check("wikilink kept verbatim", after.includes("[[Clay notes]]"));
  check("bare URL kept as a bare URL", after.includes("Dashboard: http://z270x.local:19999 ·"));
  if (!after.includes("Dashboard: http://z270x.local:19999 ·")) console.log("   got:", after.split("\n").find((l) => l.includes("Dashboard")));
  check("table kept as markdown", /\| *6 *\| *1222 *\|/.test(after));
  check("code block kept", after.includes("temp = 1222"));
  check("nested bullet kept", /\n\s{2,}[-*] overnight/.test(after));

  // 5. markdown typing still works: "# " → heading; Cmd/Ctrl+B → bold
  await page.click(`${rich} blockquote`);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("# New section");
  await page.keyboard.press("Enter");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+b" : "Control+b");
  await page.keyboard.type("strong words");
  await page.waitForTimeout(2200);
  const typed = await stored("kiln.md");
  check("typing '# ' makes a heading", /^# New section$/m.test(typed));
  check("Cmd+B makes bold", typed.includes("**strong words**"));

  // 6. Aa menu formats the current line
  await page.keyboard.press("Enter");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+b" : "Control+b");
  await page.keyboard.type("buy glaze");
  await page.click("#aaBtn");
  await page.click('#aaMenu [data-fmt="checklist"]');
  await page.waitForTimeout(2200);
  check("Aa → Checklist makes a task", /- \[ \] buy glaze/.test(await stored("kiln.md")));

  // 7. ⋯ → Edit markdown shows the source; edits there show up in rich mode
  await page.click("#moreBtn");
  await page.click("#modeBtn");
  await page.waitForSelector("#editor.source .cm-content", { timeout: 5000 });
  check("Edit markdown shows raw markdown", /## Firing schedule/.test(await page.textContent("#editor.source .cm-content")));
  await page.click("#editor.source .cm-content");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.type("\n\nAdded in **markdown** mode.");
  await page.waitForTimeout(2000);
  await page.click("#moreBtn");
  await page.click("#modeBtn");
  await page.waitForSelector(rich, { timeout: 5000 });
  check("markdown-mode edit appears rendered in rich mode", (await page.locator(`${rich} strong`, { hasText: "markdown" }).count()) === 1);

  // 8. a note the rich view can't keep exactly opens as markdown, with a notice
  await open("raw-html.md");
  await page.waitForSelector("#editor.source", { timeout: 5000 });
  check("raw HTML/footnote note opens as markdown", await page.isVisible("#modeNote"));

  // 10. editing one block leaves every other block byte-identical (agents get small diffs)
  await open("styled.md");
  await page.waitForSelector(rich);
  await page.locator(`${rich} p`, { hasText: "Last para." }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" edited");
  await page.waitForTimeout(2200);
  const styled = await stored("styled.md");
  check("one-block edit: other blocks keep their exact text", styled.includes("* alpha\n* beta") && styled.includes("| a   | b   |") && styled.includes("Last para. edited"));

  // 11. a remote edit to the open note shows up, and local typing merges with it
  await open("live.md");
  await page.waitForSelector(rich);
  await call(url, "edit_note", { path: "live.md", operation: "append", content: "Third from an agent." });
  await page.waitForFunction(() => /Third from an agent/.test(document.querySelector("#editor .ProseMirror")?.textContent ?? ""), null, { timeout: 8000 }).catch(() => {});
  check("remote edit appears in the open note", /Third from an agent/.test(await page.textContent(rich)));
  await page.locator(`${rich} p`, { hasText: "First paragraph." }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Typed here.");
  await call(url, "edit_note", { path: "live.md", operation: "append", content: "Fourth from an agent." });
  await page.waitForTimeout(3500);
  const live = await stored("live.md");
  check("local typing and a concurrent agent edit both survive", live.includes("First paragraph. Typed here.") && live.includes("Fourth from an agent.") && live.includes("Third from an agent."));

  // 12. "Edit markdown" is per note
  await page.click("#moreBtn");
  await page.click("#modeBtn");
  await page.waitForSelector("#editor.source");
  await open("styled.md");
  check("switching one note to markdown leaves other notes rich", await page.isVisible(rich));

  // 9. phone: the Aa bar
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${base}/app`);
  await phone.waitForSelector("#main", { state: "visible", timeout: 15000 });
  await phone.click('[data-path="kiln.md"]');
  await phone.waitForSelector(rich, { timeout: 10000 });
  await phone.click(`${rich} h2`);
  await phone.click("#aaBtn");
  check("phone: Aa bar opens", await phone.isVisible('#aaMenu [data-fmt="checklist"]'));
  if (process.env.SHOTS) await phone.screenshot({ path: `${process.env.SHOTS}/rich-phone.png` });

  check("no uncaught page errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  await relay.close();
}
process.exit(failed ? 1 : 0);
