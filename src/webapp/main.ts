/**
 * The hosted web app (served by the relay at /app).
 *
 * All crypto is client-side: phrase → keys → unseal space key → decrypt.
 * 1e part 1: full product UI — brand header, titles, folder groups, daily
 * capture — and EDITING via CodeMirror 6, pushing encrypted whole-file
 * updates through the relay (CRDT merge replaces LWW in 1e part 2).
 */
import { marked } from "marked";
import { EditorView, minimalSetup } from "codemirror";
import { livePreview } from "./livemd.js";
import { keymap, ViewUpdate } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { accountFromPhrase, generatePhrase, certifyDevice, certifyAgent, type PrincipalIdentity } from "../account.js";
import { ulid } from "ulid";
import {
  randomKey,
  sealBox,
  toB64,
  fromB64,
  deriveNoteKey,
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
import { findEnvelope, isLockedContent, wrapLockedBody, LOCK_AAD } from "../notelock.js";

interface DocPayload {
  v: 1;
  path: string;
  content: string;
  mtimeMs: number;
  deleted?: boolean;
}

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let identity: PrincipalIdentity | null = null;
let client: RelayClient | null = null;
let spaceKey: Uint8Array | null = null;
let spaceId: string | null = null;
// Held in memory for THIS session only (never persisted) so the Account panel
// can re-reveal the phrase after signup. Cleared on lock/reload.
let sessionPhrase = "";
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

async function unlock(phrase: string, opts: { createSpaceIfEmpty?: boolean } = {}): Promise<void> {
  const status = $("#status");
  status.textContent = "Deriving keys…";
  const account = accountFromPhrase(phrase);
  identity = browserIdentity(phrase);
  sessionPhrase = phrase.trim().toLowerCase().split(/\s+/).join(" ");
  client = new RelayClient("", identity);
  status.textContent = "Registering this browser as a device…";
  await client.register();
  status.textContent = "Fetching spaces…";
  const spaces = await client.listSpaces();
  let chosen = spaces[0];
  if (!chosen) {
    if (!opts.createSpaceIfEmpty) {
      throw new Error("No spaces for this account yet — create an account below, or run 'vortex-notes sync link' on a machine.");
    }
    status.textContent = "Creating your encrypted space…";
    const key = randomKey();
    const record = {
      id: "sp-" + ulid().toLowerCase(),
      name: "personal",
      createdAt: new Date().toISOString(),
      sealedKeys: {
        [identity.file.device.signPub]: toHex(sealBox(key, identity.deviceBox.pub)),
        [identity.file.accountSignPub]: toHex(sealBox(key, account.box.pub)),
      },
    };
    await client.createSpace(record);
    chosen = { id: record.id, sealedKeys: record.sealedKeys, createdAt: record.createdAt };
  }
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
      if (payload.deleted) {
        notes.delete(payload.path);
        if (payload.path === current && !editor) {
          current = null;
          $("#note").innerHTML = '<div class="placeholder">That note was deleted on another device.</div>';
          setMobileNoteOpen(false);
        }
        continue;
      }
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
      const lock = isLockedContent(n.content) ? "🔒 " : "";
      html += `<a href="#" data-path="${esc(n.path)}" class="${current === n.path ? "active" : ""}">${lock}${esc(noteTitle(n))}</a>`;
    }
  }
  $("#list").innerHTML = html || '<div class="empty">Nothing here yet — create a note with ＋</div>';
}

function setMobileNoteOpen(open: boolean): void {
  $("#main").classList.toggle("note-open", open);
}

let saveTimer: number | undefined;
let lastSaved = "";
let saveState: "idle" | "dirty" | "saving" = "idle";
// The frontmatter block for the note currently open in the editor. The editor
// edits the BODY only; on save we prepend this back. Empty if no frontmatter.
let editorFmPrefix = "";
// The editor's body content as last persisted. We compare bodies (not full
// content) so re-encrypting a locked note doesn't look like an edit.
let lastSavedBody = "";
// Password-lock context for the currently-open note (null = not locked).
let lockedCtx: { key: Uint8Array; salt: Uint8Array } | null = null;
// Session cache of note passwords: unlocked notes stay unlocked until reload/lock.
const sessionKeys = new Map<string, { key: Uint8Array; salt: Uint8Array }>();

/** Full content to persist = stashed frontmatter + (re-encrypted) editor body. */
function editorContent(): string {
  const bodyNow = editor ? editor.state.doc.toString() : "";
  return editorFmPrefix + (lockedCtx ? wrapLockedBody(lockedCtx.salt, lockedCtx.key, bodyNow) : bodyNow);
}

function setSaveState(text: string): void {
  const el = document.getElementById("savestate");
  if (el) el.textContent = text;
}

async function flushSave(path: string): Promise<void> {
  if (!editor) return;
  const bodyNow = editor.state.doc.toString();
  if (bodyNow === lastSavedBody) return; // compare plaintext body, not (re-encrypted) content
  const content = editorContent();
  saveState = "saving";
  setSaveState("saving…");
  try {
    await pushNote(path, content);
    lastSavedBody = bodyNow;
    lastSaved = content;
    saveState = "idle";
    setSaveState("saved");
    window.setTimeout(() => saveState === "idle" && setSaveState(""), 1500);
  } catch (e) {
    saveState = "dirty";
    setSaveState("offline — retrying");
    window.setTimeout(() => void flushSave(path), 5000);
  }
}

/** Byte offset where the body starts, i.e. just past the frontmatter block. */
function frontmatterEnd(content: string): number {
  const m = content.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? m[0].length : 0;
}

function noteMeta(content: string): { created?: string; updated?: string; tags: string[] } {
  const { frontmatter } = splitFrontmatter(content);
  const tags: string[] = [];
  if (!frontmatter) return { tags };
  const created = frontmatter.match(/^created:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
  const updated = frontmatter.match(/^updated:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
  const inline = frontmatter.match(/^tags:\s*\[(.+)\]\s*$/m);
  if (inline) {
    tags.push(...inline[1].split(",").map((t) => t.trim().replace(/['"]/g, "")).filter(Boolean));
  } else {
    let inTags = false;
    for (const l of frontmatter.split("\n")) {
      if (/^tags:\s*$/.test(l)) { inTags = true; continue; }
      if (!inTags) continue;
      const mt = l.match(/^\s+-\s*['"]?(.+?)['"]?\s*$/);
      if (mt) tags.push(mt[1]);
      else if (l.trim() && !/^\s/.test(l)) break;
    }
  }
  return { created, updated, tags };
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Small dim detail line: edited-date + tags. Replaces dumping raw frontmatter. */
function metaDetailHtml(content: string): string {
  const m = noteMeta(content);
  const bits: string[] = [];
  const d = fmtDate(m.updated) || fmtDate(m.created);
  if (d) bits.push((m.updated ? "edited " : "") + d);
  if (m.tags.length) bits.push(m.tags.slice(0, 8).map((t) => "#" + t).join(" "));
  return bits.length ? `<div class="notemeta">${esc(bits.join("   ·   "))}</div>` : "";
}

/** Set/replace the frontmatter title (keeps the sidebar name in sync on rename). */
function setFrontmatterTitle(content: string, title: string): string {
  const { frontmatter, body } = splitFrontmatter(content);
  if (!frontmatter) return content;
  const fm = /^title:/m.test(frontmatter)
    ? frontmatter.replace(/^title:.*$/m, `title: ${title}`)
    : `title: ${title}\n${frontmatter}`;
  return `---\n${fm}\n---\n\n${body.replace(/^\n+/, "")}`;
}

function noteHead(n: DocPayload, buttons: string): string {
  return (
    `<div class="notehead"><div class="meta">` +
    `<button class="mbtn backbtn" id="backBtn">‹ notes</button>` +
    `<span class="path">${esc(n.path)}</span><span id="savestate"></span>` +
    buttons +
    `</div><h1>${esc(noteTitle(n))}</h1>${metaDetailHtml(n.content)}</div>`
  );
}

/** Default view: the live editor — the note IS the editing surface. */
function openNote(path: string): void {
  const n = notes.get(path);
  if (!n) return;
  void closeEditor();
  current = path;
  lastSaved = n.content;
  const env = findEnvelope(splitFrontmatter(n.content).body);
  if (env) {
    const cached = sessionKeys.get(path);
    if (!cached) return showLockScreen(path, n, env);
    let plain: string;
    try {
      plain = new TextDecoder().decode(decryptPayload(cached.key, env.ct, LOCK_AAD));
    } catch {
      sessionKeys.delete(path);
      return showLockScreen(path, n, env);
    }
    lockedCtx = { key: cached.key, salt: cached.salt };
    // Frontmatter prefix ends with the closing '---\n'; a blank line then the body.
    editorFmPrefix = n.content.slice(0, frontmatterEnd(n.content)) + "\n";
    mountEditor(path, n, plain, true);
    return;
  }
  lockedCtx = null;
  const fmEnd = frontmatterEnd(n.content);
  let prefix = n.content.slice(0, fmEnd);
  let body = n.content.slice(fmEnd);
  const lead = body.match(/^\n+/); // move blank lines after frontmatter into the prefix
  if (lead) {
    prefix += lead[0];
    body = body.slice(lead[0].length);
  }
  editorFmPrefix = prefix; // editorContent() = prefix + body === original, exactly
  mountEditor(path, n, body, false);
}

/** Shared editor mount used by normal and unlocked-locked notes. */
function mountEditor(path: string, n: DocPayload, body: string, locked: boolean): void {
  lastSavedBody = body;
  $("#note").innerHTML =
    noteHead(n, `<button class="mbtn" id="readBtn">read</button><button class="mbtn" id="moreBtn">⋯</button><button class="mbtn danger" id="delBtn">delete</button>`) +
    noteMenuHtml(locked) +
    `<div id="cm"></div>`;
  const scheduleSave = () => {
    saveState = "dirty";
    setSaveState("·");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSave(path), 1200);
  };
  editor = new EditorView({
    doc: body,
    parent: $("#cm"),
    extensions: [
      minimalSetup,
      markdown(),
      EditorView.lineWrapping,
      ...livePreview,
      keymap.of([{ key: "Mod-s", run: () => (void flushSave(path), true) }]),
      EditorView.updateListener.of((u: ViewUpdate) => {
        if (u.docChanged) scheduleSave();
      }),
      EditorView.domEventHandlers({ blur: () => void flushSave(path) }),
    ],
  });
  $("#readBtn").addEventListener("click", () => void closeEditor().then(() => openReader(path)));
  wireCommonNoteButtons(path);
  setMobileNoteOpen(true);
  renderList(($("#filter") as HTMLInputElement).value.trim().toLowerCase());
  $("#pane").scrollTop = 0;
}

/** Prompt for the note password; on success cache it and reopen unlocked. */
function showLockScreen(path: string, n: DocPayload, env: { salt: Uint8Array; ct: Uint8Array }): void {
  lockedCtx = null;
  current = path;
  $("#note").innerHTML =
    noteHead(n, `<button class="mbtn danger" id="delBtn">delete</button>`) +
    `<div class="lockscreen">` +
    `<div class="lockicon">🔒</div>` +
    `<p>This note is password-protected.</p>` +
    `<input id="unlockPw" type="password" placeholder="Password" autocomplete="off">` +
    `<button id="unlockGo" class="mbtn primary">Unlock</button>` +
    `<div id="unlockErr" class="lockerr"></div></div>`;
  const attempt = () => {
    const pw = ($("#unlockPw") as HTMLInputElement).value;
    if (!pw) return;
    $("#unlockErr").textContent = "Unlocking…";
    // scrypt is heavy; defer a tick so the label paints.
    window.setTimeout(() => {
      try {
        const key = deriveNoteKey(pw, env.salt);
        decryptPayload(key, env.ct, LOCK_AAD); // throws if wrong password
        sessionKeys.set(path, { key, salt: env.salt });
        openNote(path);
      } catch {
        $("#unlockErr").textContent = "Wrong password.";
      }
    }, 20);
  };
  $("#unlockGo").addEventListener("click", attempt);
  ($("#unlockPw") as HTMLInputElement).addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") attempt();
  });
  $("#delBtn").addEventListener("click", () => {
    if (!confirm(`Delete ${path} everywhere?`)) return;
    void deleteNote(path).then(() => {
      current = null;
      $("#note").innerHTML = '<div class="placeholder">Deleted.</div>';
      setMobileNoteOpen(false);
      renderList();
    });
  });
  ($("#unlockPw") as HTMLInputElement).focus();
  setMobileNoteOpen(true);
  renderList(($("#filter") as HTMLInputElement).value.trim().toLowerCase());
}

/** Reading view: fully rendered markdown; tap the text to go back to live editing. */
function openReader(path: string): void {
  const n = notes.get(path);
  if (!n) return;
  void closeEditor();
  current = path;
  let { body } = splitFrontmatter(n.content);
  const env = findEnvelope(body);
  if (env) {
    const cached = sessionKeys.get(path);
    if (!cached) return showLockScreen(path, n, env);
    try {
      body = new TextDecoder().decode(decryptPayload(cached.key, env.ct, LOCK_AAD));
    } catch {
      sessionKeys.delete(path);
      return showLockScreen(path, n, env);
    }
  }
  $("#note").innerHTML =
    noteHead(n, `<button class="mbtn primary" id="liveBtn">edit</button><button class="mbtn" id="moreBtn">⋯</button><button class="mbtn danger" id="delBtn">delete</button>`) +
    noteMenuHtml(env !== null) +
    `<article id="article" title="Tap to edit">${marked.parse(body, { async: false }) as string}</article>`;
  $("#liveBtn").addEventListener("click", () => openNote(path));
  $("#article").addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a, input")) return;
    openNote(path);
  });
  wireCommonNoteButtons(path);
  setMobileNoteOpen(true);
  renderList(($("#filter") as HTMLInputElement).value.trim().toLowerCase());
  $("#pane").scrollTop = 0;
}

function noteMenuHtml(locked: boolean): string {
  return (
    `<div class="notemenu" id="noteMenu" hidden>` +
    `<button class="menuitem" id="renameBtn">✎  Rename / move</button>` +
    `<button class="menuitem" id="dupBtn">⧉  Duplicate</button>` +
    (locked
      ? `<button class="menuitem" id="unlockPermBtn">🔓  Remove password</button>`
      : `<button class="menuitem" id="lockBtnItem">🔒  Password-protect</button>`) +
    `</div>`
  );
}

/** Lock the currently-open note with a new password (must be open/unlocked). */
async function lockNote(path: string): Promise<void> {
  if (!editor) return;
  const pw = prompt("Set a password for this note. If you lose it, the note is unrecoverable.");
  if (!pw) return;
  if (prompt("Confirm the password:") !== pw) {
    alert("Passwords didn't match.");
    return;
  }
  const salt = randomKey(); // 32-byte scrypt salt
  const key = deriveNoteKey(pw, salt);
  const plainBody = editor.state.doc.toString();
  lockedCtx = { key, salt };
  sessionKeys.set(path, { key, salt });
  lastSavedBody = plainBody; // body itself unchanged; only its stored form is now encrypted
  await pushNote(path, editorContent());
  lastSaved = notes.get(path)?.content ?? "";
  openNote(path);
}

/** Remove the password from the currently-open (unlocked) note. */
async function unlockPermanent(path: string): Promise<void> {
  if (!editor) return;
  const plainBody = editor.state.doc.toString();
  lockedCtx = null;
  sessionKeys.delete(path);
  await pushNote(path, editorFmPrefix + plainBody);
  openNote(path);
}

async function renameNote(oldPath: string): Promise<void> {
  const n = notes.get(oldPath);
  if (!n) return;
  const input = prompt("New name (prefix with folder/ to move it):", oldPath.replace(/\.md$/, ""));
  if (!input) return;
  let folder = "";
  let title = input.trim().replace(/\.md$/, "");
  const slash = title.lastIndexOf("/");
  if (slash > 0) {
    folder = title.slice(0, slash);
    title = title.slice(slash + 1);
  }
  const newPath = (folder ? folder.replace(/\/+$/, "") + "/" : "") + slugify(title) + ".md";
  if (newPath === oldPath) return;
  if (notes.has(newPath)) {
    alert(`${newPath} already exists.`);
    return;
  }
  await closeEditor();
  await pushNote(newPath, setFrontmatterTitle(n.content, title));
  await deleteNote(oldPath);
  renderList();
  openNote(newPath);
}

async function duplicateNote(path: string): Promise<void> {
  const n = notes.get(path);
  if (!n) return;
  const base = path.replace(/\.md$/, "");
  let newPath = base + "-copy.md";
  let i = 2;
  while (notes.has(newPath)) newPath = `${base}-copy-${i++}.md`;
  await closeEditor();
  await pushNote(newPath, n.content);
  renderList();
  openNote(newPath);
}

function wireCommonNoteButtons(path: string): void {
  $("#backBtn").addEventListener("click", () => {
    void closeEditor();
    setMobileNoteOpen(false);
  });
  const moreBtn = document.getElementById("moreBtn");
  const noteMenu = document.getElementById("noteMenu");
  if (moreBtn && noteMenu) {
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      (noteMenu as HTMLElement & { hidden: boolean }).hidden = !(noteMenu as HTMLElement & { hidden: boolean }).hidden;
    });
    document.addEventListener("click", (e) => {
      if (!(noteMenu as HTMLElement).hidden && !(e.target as HTMLElement).closest("#noteMenu, #moreBtn")) {
        (noteMenu as HTMLElement & { hidden: boolean }).hidden = true;
      }
    });
    $("#renameBtn").addEventListener("click", () => void renameNote(path).catch((e) => alert((e as Error).message)));
    $("#dupBtn").addEventListener("click", () => void duplicateNote(path).catch((e) => alert((e as Error).message)));
    document.getElementById("lockBtnItem")?.addEventListener("click", () => void lockNote(path).catch((e) => alert((e as Error).message)));
    document.getElementById("unlockPermBtn")?.addEventListener("click", () => void unlockPermanent(path).catch((e) => alert((e as Error).message)));
  }
  $("#delBtn").addEventListener("click", () => {
    if (!confirm(`Delete ${path} everywhere?`)) return;
    void closeEditor();
    void deleteNote(path)
      .then(() => {
        current = null;
        $("#note").innerHTML = '<div class="placeholder">Deleted.</div>';
        setMobileNoteOpen(false);
        renderList();
      })
      .catch((e) => alert((e as Error).message));
  });
}

/** Flush any pending edit, then tear the editor down. */
async function closeEditor(): Promise<void> {
  window.clearTimeout(saveTimer);
  if (editor && current) {
    const path = current;
    const bodyNow = editor.state.doc.toString();
    const content = editorContent();
    editor.destroy();
    editor = null;
    editorFmPrefix = "";
    lockedCtx = null;
    if (bodyNow !== lastSavedBody) {
      try {
        await pushNote(path, content);
        lastSaved = content;
      } catch {
        /* offline: content is still in notes map via next autosave attempt */
      }
    }
  } else {
    editor?.destroy();
    editor = null;
    editorFmPrefix = "";
    lockedCtx = null;
  }
}

async function deleteNote(path: string): Promise<void> {
  if (!client || !spaceKey || !spaceId) throw new Error("Locked.");
  const payload: DocPayload = { v: 1, path, content: "", mtimeMs: Date.now(), deleted: true };
  const blob = encryptPayload(spaceKey, utf8(JSON.stringify(payload)), `vortex-doc-v1:${path}`);
  const seq = await client.pushUpdate(spaceId, path, blob);
  cursor = Math.max(cursor, seq);
  notes.delete(path);
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
      openNote(path);
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

// --- create account: phrase generated in this tab, shown once ---
let freshPhrase = "";
$("#showCreateBtn").addEventListener("click", () => {
  freshPhrase = generatePhrase();
  $("#newPhrase").textContent = freshPhrase;
  ($("#savedCheck") as HTMLInputElement).checked = false;
  ($("#createBtn") as HTMLButtonElement).disabled = true;
  $("#unlockView").hidden = true;
  $("#createView").hidden = false;
});
$("#backToUnlockBtn").addEventListener("click", () => {
  freshPhrase = "";
  $("#newPhrase").textContent = "";
  $("#createView").hidden = true;
  $("#unlockView").hidden = false;
});
$("#copyPhraseBtn").addEventListener("click", () => {
  void navigator.clipboard.writeText(freshPhrase).then(() => {
    $("#copyPhraseBtn").textContent = "copied — clear your clipboard after saving it";
  });
});
$("#savedCheck").addEventListener("change", (e) => {
  ($("#createBtn") as HTMLButtonElement).disabled = !(e.target as HTMLInputElement).checked;
});
$("#createBtn").addEventListener("click", () => {
  unlock(freshPhrase, { createSpaceIfEmpty: true }).catch((e) => {
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
const menu = $("#menu");
const tipsOverlay = $("#tipsOverlay");

// --- pair an agent: full approval happens in this tab (we are a certified device) ---
const pairOverlay = $("#pairOverlay");
let pendingPair: { code: string; name: string; signPub: string; encPub: string } | null = null;
function pairReset(): void {
  pendingPair = null;
  ($("#pairCode") as HTMLInputElement).value = "";
  $("#pairStep1").hidden = false;
  $("#pairStep2").hidden = true;
  $("#pairStatus").textContent = "";
}
$("#pairBtn").addEventListener("click", () => {
  if (!identity || !spaceKey) return alert("Unlock first.");
  pairReset();
  document.querySelectorAll(".relayhost").forEach((el) => (el.textContent = location.origin));
  pairOverlay.hidden = false;
  ($("#pairCode") as HTMLInputElement).focus();
});
$("#pairClose").addEventListener("click", () => (pairOverlay.hidden = true));
pairOverlay.addEventListener("click", (e) => {
  if (e.target === pairOverlay) pairOverlay.hidden = true;
});
$("#pairLookup").addEventListener("click", () => {
  const code = ($("#pairCode") as HTMLInputElement).value.trim().toUpperCase();
  if (code.length !== 6 || !client) return;
  $("#pairStatus").textContent = "Looking up…";
  client
    .getPairing(code)
    .then((req) => {
      pendingPair = req;
      $("#pairName").textContent = req.name;
      $("#pairFp").textContent = req.signPub.slice(0, 16) + "…";
      $("#pairStep1").hidden = true;
      $("#pairStep2").hidden = false;
      $("#pairStatus").textContent = "";
    })
    .catch((e) => ($("#pairStatus").textContent = (e as Error).message));
});
($("#pairCode") as HTMLInputElement).addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") $("#pairLookup").click();
});
$("#pairApprove").addEventListener("click", () => {
  if (!pendingPair || !identity || !client || !spaceKey || !spaceId) return;
  const req = pendingPair;
  const mode = (document.querySelector('input[name="pairMode"]:checked') as HTMLInputElement).value as "ro" | "rw";
  $("#pairStatus").textContent = "Certifying and granting…";
  void (async () => {
    const cert = certifyAgent(identity!.deviceSign, fromHex(req.signPub), fromHex(req.encPub), req.name, [spaceId!], mode);
    // grant: add the agent's sealed space key and push the updated membership
    const spaces = await client!.listSpaces();
    const space = spaces.find((s) => s.id === spaceId)!;
    const sealedKeys = { ...space.sealedKeys, [cert.signPub]: toHex(sealBox(spaceKey!, fromHex(req.encPub))) };
    await client!.createSpace({ id: spaceId!, name: spaceId!, createdAt: space.createdAt, sealedKeys });
    // register the agent so it can authenticate the moment it polls
    await fetch("/v1/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountSignPub: identity!.file.accountSignPub,
        accountEncPub: identity!.file.accountEncPub,
        device: cert,
        chain: identity!.file.device,
      }),
    });
    const grant = {
      v: 1,
      relay: location.origin,
      accountSignPub: identity!.file.accountSignPub,
      accountEncPub: identity!.file.accountEncPub,
      cert,
      chain: identity!.file.device,
    };
    await client!.approvePairing(req.code, toB64(sealBox(utf8(JSON.stringify(grant)), fromHex(req.encPub))));
    $("#pairStatus").textContent = `Approved — "${req.name}" is connecting itself now.`;
    window.setTimeout(() => (pairOverlay.hidden = true), 2500);
  })().catch((e) => ($("#pairStatus").textContent = (e as Error).message));
});
// --- account & recovery: reveal the session phrase (never persisted) ---
const acctOverlay = $("#acctOverlay");
$("#acctBtn").addEventListener("click", () => {
  if (!identity) return alert("Unlock first.");
  $("#acctFp").textContent = identity.file.accountSignPub.slice(0, 16) + "…";
  const reveal = $("#phraseReveal");
  const hasPhrase = sessionPhrase.length > 0;
  $("#acctNote").hidden = hasPhrase;
  reveal.style.display = hasPhrase ? "" : "none";
  ($("#acctCopy") as HTMLButtonElement).style.display = hasPhrase ? "" : "none";
  ($("#acctDownload") as HTMLButtonElement).style.display = hasPhrase ? "" : "none";
  reveal.textContent = "tap to reveal";
  reveal.classList.add("blurred");
  acctOverlay.hidden = false;
});
$("#phraseReveal").addEventListener("click", () => {
  const reveal = $("#phraseReveal");
  if (reveal.classList.contains("blurred")) {
    reveal.textContent = sessionPhrase;
    reveal.classList.remove("blurred");
  } else {
    reveal.textContent = "tap to reveal";
    reveal.classList.add("blurred");
  }
});
$("#acctCopy").addEventListener("click", () => {
  void navigator.clipboard.writeText(sessionPhrase).then(() => {
    $("#acctCopy").textContent = "copied — clear your clipboard after saving";
    window.setTimeout(() => ($("#acctCopy").textContent = "copy"), 4000);
  });
});
$("#acctDownload").addEventListener("click", () => {
  const blob = new Blob([`Vortex Notes recovery phrase\nAccount ${identity?.file.accountSignPub.slice(0, 16)}…\n\n${sessionPhrase}\n\nAnyone with these 12 words can read your notes. There is no reset.\n`], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "vortex-notes-recovery.txt";
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#acctClose").addEventListener("click", () => (acctOverlay.hidden = true));
acctOverlay.addEventListener("click", (e) => {
  if (e.target === acctOverlay) acctOverlay.hidden = true;
});

$("#tipsBtn").addEventListener("click", () => {
  tipsOverlay.hidden = false;
});
$("#tipsClose").addEventListener("click", () => {
  tipsOverlay.hidden = true;
});
tipsOverlay.addEventListener("click", (e) => {
  if (e.target === tipsOverlay) tipsOverlay.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Escape" && !tipsOverlay.hidden) tipsOverlay.hidden = true;
});
$("#menuBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  menu.hidden = !(menu as HTMLElement & { hidden: boolean }).hidden;
});
document.addEventListener("click", (e) => {
  if (!menu.hidden && !(e.target as HTMLElement).closest(".menuwrap")) menu.hidden = true;
});
menu.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest(".menuitem")) menu.hidden = true;
});
$("#refreshBtn").addEventListener("click", () => void refresh().catch((e) => alert((e as Error).message)));
$("#filter").addEventListener("input", (e) => renderList((e.target as HTMLInputElement).value.trim().toLowerCase()));
$("#lockBtn").addEventListener("click", () => {
  sessionPhrase = "";
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

window.addEventListener("beforeunload", () => {
  if (editor && current) void closeEditor();
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
