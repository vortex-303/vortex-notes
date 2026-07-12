/**
 * The hosted web app (served by the relay at /app).
 *
 * All crypto is client-side: phrase → keys → unseal space key → decrypt.
 * 1e part 1: full product UI — brand header, titles, folder groups, daily
 * capture — and EDITING via CodeMirror 6, pushing encrypted whole-file
 * updates through the relay (CRDT merge replaces LWW in 1e part 2).
 */
import { marked } from "marked";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { accountFromPhrase, certifyDevice, type PrincipalIdentity } from "../account.js";
import {
  randomSignKeypair,
  randomBoxKeypair,
  signKeypairFromSeed,
  boxKeypairFromSeed,
  openBox,
  encryptPayload,
  decryptPayload,
  toHex,
  fromHex,
  utf8,
} from "../crypto.js";
import { RelayClient } from "../relay/client.js";
import { slugify, splitFrontmatter, titleFromRaw } from "../textutil.js";

interface DocPayload {
  v: 1;
  path: string;
  content: string;
  mtimeMs: number;
}

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let identity: PrincipalIdentity | null = null;
let client: RelayClient | null = null;
let spaceKey: Uint8Array | null = null;
let spaceId: string | null = null;
let cursor = 0;
const notes = new Map<string, DocPayload>();
let current: string | null = null;
let editor: EditorView | null = null;
let pollTimer: number | undefined;

// ---------- identity ----------
function browserIdentity(phrase: string): PrincipalIdentity {
  const account = accountFromPhrase(phrase);
  const stored = localStorage.getItem("vn-device");
  if (stored) {
    const d = JSON.parse(stored) as {
      account: string;
      signPriv: string;
      boxPriv: string;
      device: PrincipalIdentity["file"]["device"];
    };
    if (d.account === toHex(account.sign.pub)) {
      return {
        file: { accountSignPub: d.account, accountEncPub: toHex(account.box.pub), device: d.device },
        deviceSign: signKeypairFromSeed(fromHex(d.signPriv)),
        deviceBox: boxKeypairFromSeed(fromHex(d.boxPriv)),
      };
    }
    localStorage.removeItem("vn-device");
  }
  const deviceSign = randomSignKeypair();
  const deviceBox = randomBoxKeypair();
  const device = certifyDevice(account, deviceSign, deviceBox, `browser@${location.host}`);
  localStorage.setItem(
    "vn-device",
    JSON.stringify({ account: toHex(account.sign.pub), signPriv: toHex(deviceSign.priv), boxPriv: toHex(deviceBox.priv), device })
  );
  return {
    file: { accountSignPub: toHex(account.sign.pub), accountEncPub: toHex(account.box.pub), device },
    deviceSign,
    deviceBox,
  };
}

async function unlock(phrase: string): Promise<void> {
  const status = $("#status");
  status.textContent = "Deriving keys…";
  const account = accountFromPhrase(phrase);
  identity = browserIdentity(phrase);
  client = new RelayClient("", identity);
  status.textContent = "Registering this browser as a device…";
  await client.register();
  status.textContent = "Fetching spaces…";
  const spaces = await client.listSpaces();
  if (!spaces.length) throw new Error("No spaces synced to this relay yet. Run 'vortex-notes sync link' on a machine first.");
  const chosen = spaces[0];
  const sealed = chosen.sealedKeys[identity.file.accountSignPub];
  if (!sealed) throw new Error("This space has no key sealed to your account.");
  spaceKey = openBox(fromHex(sealed), account.box);
  spaceId = chosen.id;
  await refresh();
  $("#lock").style.display = "none";
  $("#main").style.display = "flex";
  pollTimer = window.setInterval(() => void refresh().catch(() => undefined), 30_000);
}

// ---------- sync ----------
async function refresh(): Promise<void> {
  if (!client || !spaceKey || !spaceId) return;
  const updates = await client.pullUpdates(spaceId, cursor);
  let changedCurrent = false;
  for (const u of updates) {
    cursor = Math.max(cursor, u.seq);
    try {
      const payload = JSON.parse(
        new TextDecoder().decode(decryptPayload(spaceKey, u.blob, `vortex-doc-v1:${u.doc}`))
      ) as DocPayload;
      notes.set(payload.path, payload);
      if (payload.path === current) changedCurrent = true;
    } catch {
      /* skip undecryptable update — never crash the reader */
    }
  }
  renderList(($("#filter") as HTMLInputElement).value.trim().toLowerCase());
  if (changedCurrent && current && !editor) openNote(current);
}

async function pushNote(path: string, content: string): Promise<void> {
  if (!client || !spaceKey || !spaceId) throw new Error("Locked.");
  const payload: DocPayload = { v: 1, path, content, mtimeMs: Date.now() };
  const blob = encryptPayload(spaceKey, utf8(JSON.stringify(payload)), `vortex-doc-v1:${path}`);
  const seq = await client.pushUpdate(spaceId, path, blob);
  cursor = Math.max(cursor, seq);
  notes.set(path, payload);
}

// ---------- rendering ----------
function noteTitle(n: DocPayload): string {
  return titleFromRaw(n.path, n.content);
}

function renderList(filter = ""): void {
  const items = [...notes.values()]
    .filter((n) => !filter || n.path.toLowerCase().includes(filter) || n.content.toLowerCase().includes(filter))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const groups = new Map<string, DocPayload[]>();
  for (const n of items) {
    const folder = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "";
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(n);
  }
  let html = "";
  for (const [folder, group] of [...groups.entries()].sort()) {
    html += `<div class="folder">${esc(folder || "· root")}</div>`;
    for (const n of group) {
      html += `<a href="#" data-path="${esc(n.path)}" class="${current === n.path ? "active" : ""}">${esc(noteTitle(n))}</a>`;
    }
  }
  $("#list").innerHTML = html || '<div class="empty">Nothing here yet — create a note with ＋</div>';
}

function metaButtons(mode: "view" | "edit"): string {
  return mode === "view"
    ? '<button class="mbtn" id="editBtn">edit</button><button class="mbtn" id="srcBtn">source</button>'
    : '<button class="mbtn primary" id="saveBtn">save</button><button class="mbtn" id="cancelBtn">cancel</button>';
}

function openNote(path: string): void {
  const n = notes.get(path);
  if (!n) return;
  closeEditor();
  current = path;
  const { body } = splitFrontmatter(n.content);
  $("#note").innerHTML =
    `<div class="notehead"><div class="meta"><span class="path">${esc(n.path)}</span>${metaButtons("view")}</div>` +
    `<h1>${esc(noteTitle(n))}</h1></div>` +
    `<article>${marked.parse(body, { async: false }) as string}</article>`;
  $("#editBtn").addEventListener("click", () => openEditor(path));
  $("#srcBtn").addEventListener("click", () => {
    $("#note").querySelector("article")!.outerHTML = `<pre class="rawview">${esc(n.content)}</pre>`;
    ($("#srcBtn") as HTMLButtonElement).disabled = true;
  });
  renderList(($("#filter") as HTMLInputElement).value.trim().toLowerCase());
  $("#pane").scrollTop = 0;
}

function openEditor(path: string): void {
  const n = notes.get(path);
  if (!n) return;
  closeEditor();
  current = path;
  $("#note").innerHTML =
    `<div class="notehead"><div class="meta"><span class="path">${esc(n.path)}</span>${metaButtons("edit")}</div>` +
    `<h1>${esc(noteTitle(n))}</h1></div><div id="cm"></div>` +
    `<div class="editnote">full note incl. frontmatter · ⌘S / Ctrl+S saves & pushes encrypted</div>`;
  const save = () => {
    const content = editor?.state.doc.toString() ?? n.content;
    void pushNote(path, content)
      .then(() => {
        closeEditor();
        openNote(path);
      })
      .catch((e) => alert((e as Error).message));
    return true;
  };
  editor = new EditorView({
    doc: n.content,
    parent: $("#cm"),
    extensions: [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      keymap.of([{ key: "Mod-s", run: save }]),
      EditorView.theme({
        "&": { fontSize: "0.9rem" },
        ".cm-content": { fontFamily: "var(--mono)", padding: "1rem 0.5rem" },
        "&.cm-focused": { outline: "none" },
      }),
    ],
  });
  $("#saveBtn").addEventListener("click", () => void save());
  $("#cancelBtn").addEventListener("click", () => openNote(path));
  editor.focus();
}

function closeEditor(): void {
  editor?.destroy();
  editor = null;
}

// ---------- actions ----------
function newNote(): void {
  const input = prompt("Note title (prefix with folder/ to file it):");
  if (!input) return;
  let folder = "";
  let title = input.trim();
  const slash = title.lastIndexOf("/");
  if (slash > 0) {
    folder = title.slice(0, slash);
    title = title.slice(slash + 1);
  }
  const path = (folder ? folder.replace(/\/+$/, "") + "/" : "") + slugify(title) + ".md";
  if (notes.has(path)) {
    alert(`${path} already exists.`);
    openNote(path);
    return;
  }
  const now = new Date().toISOString();
  const content = `---\ntitle: ${title}\ncreated: '${now}'\nupdated: '${now}'\n---\n\n`;
  void pushNote(path, content)
    .then(() => {
      renderList();
      openEditor(path);
    })
    .catch((e) => alert((e as Error).message));
}

function appendDaily(text: string): void {
  const day = new Date().toISOString().slice(0, 10);
  const path = `daily/${day}.md`;
  const stamp = new Date().toISOString().slice(11, 16);
  const entry = `- **${stamp}** ${text.trim()}`;
  const existing = notes.get(path);
  const content = existing
    ? existing.content.trimEnd() + "\n" + entry + "\n"
    : `---\ntitle: ${day}\ntags:\n  - daily\n---\n\n${entry}\n`;
  void pushNote(path, content)
    .then(() => {
      renderList();
      if (current === path) openNote(path);
    })
    .catch((e) => alert((e as Error).message));
}

// ---------- wire up ----------
$("#unlockBtn").addEventListener("click", () => {
  const phrase = ($("#phrase") as HTMLInputElement).value;
  unlock(phrase).catch((e) => {
    $("#status").textContent = (e as Error).message;
  });
});
($("#phrase") as HTMLInputElement).addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") $("#unlockBtn").click();
});
$("#list").addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  e.preventDefault();
  openNote((a as HTMLElement).dataset.path ?? "");
});
$("#newBtn").addEventListener("click", newNote);
$("#refreshBtn").addEventListener("click", () => void refresh().catch((e) => alert((e as Error).message)));
$("#filter").addEventListener("input", (e) => renderList((e.target as HTMLInputElement).value.trim().toLowerCase()));
$("#lockBtn").addEventListener("click", () => {
  clearInterval(pollTimer);
  location.reload();
});
$("#daily").addEventListener("keydown", (e) => {
  const ev = e as KeyboardEvent;
  if (ev.key !== "Enter") return;
  const input = e.target as HTMLInputElement;
  if (!input.value.trim()) return;
  appendDaily(input.value);
  input.value = "";
});

// theme
const root = document.documentElement;
const savedTheme = localStorage.getItem("vn-theme");
root.setAttribute("data-theme", savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
$("#themeBtn").addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("vn-theme", next);
});
