/**
 * The hosted web app (served by the relay at /app).
 *
 * All crypto is client-side: phrase → keys → unseal space key → decrypt.
 * 1e part 1: full product UI — brand header, titles, folder groups, daily
 * capture — and EDITING via CodeMirror 6, pushing encrypted whole-file
 * updates through the relay (CRDT merge replaces LWW in 1e part 2).
 */
import { marked } from "marked";
import { createSourceEditor, type NoteEditor, type EditorMode, type FormatKind } from "./editor.js";
import { createRichEditor } from "./richedit.js";
import { tryDiff3 } from "../merge.js";
import { accountFromPhrase, generatePhrase, certifyDevice, certifyAgent, type PrincipalIdentity } from "../account.js";
import { ulid } from "ulid";
import {
  randomKey,
  sealBox,
  toB64,
  fromB64,
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
  fingerprint,
} from "../crypto.js";
import { RelayClient } from "../relay/client.js";
import { slugify, splitFrontmatter, titleFromRaw } from "../textutil.js";
import { findEnvelope, isLockedContent, wrapLockedBody, keyFromPassword, keyFromAccount, openLockedBody, makeLock, type LockMeta, type LockEnvelope } from "../notelock.js";
import { icon } from "../icons.js";

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
let freshSpace = false;
let cursor = 0;
const notes = new Map<string, DocPayload>();
let current: string | null = null;
let editor: NoteEditor | null = null;
let pollTimer: number | undefined;

// ---------- identity ----------
// Self-reported, but far more useful than "browser@host" when telling devices
// apart in the Agents panel and admin view.
function browserDeviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "browser";
  const os = /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux" : "web";
  return `${browser} · ${os}`;
}

function browserIdentity(phrase: string): PrincipalIdentity {
  const account = accountFromPhrase(phrase);
  const stored = localStorage.getItem("vn-device");
  if (stored) {
    const d = JSON.parse(stored) as {
      account: string;
      accountEnc?: string;
      signPriv: string;
      boxPriv: string;
      device: PrincipalIdentity["file"]["device"];
    };
    if (d.account === toHex(account.sign.pub)) {
      // Upgrade older blobs that predate the accountEnc field so future visits
      // can auto-unlock without the phrase.
      if (d.accountEnc !== toHex(account.box.pub)) {
        d.accountEnc = toHex(account.box.pub);
        localStorage.setItem("vn-device", JSON.stringify(d));
      }
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
  const device = certifyDevice(account, deviceSign, deviceBox, browserDeviceName());
  localStorage.setItem(
    "vn-device",
    JSON.stringify({
      account: toHex(account.sign.pub),
      accountEnc: toHex(account.box.pub),
      signPriv: toHex(deviceSign.priv),
      boxPriv: toHex(deviceBox.priv),
      device,
    })
  );
  return {
    file: { accountSignPub: toHex(account.sign.pub), accountEncPub: toHex(account.box.pub), device },
    deviceSign,
    deviceBox,
  };
}

async function unlock(phrase: string, opts: { createSpaceIfEmpty?: boolean } = {}): Promise<void> {
  // If this login fails (wrong words, empty account), restore whatever device
  // blob was here before — a typo must never cost a working auto-unlock.
  const prevBlob = localStorage.getItem("vn-device");
  try {
    await unlockInner(phrase, opts);
  } catch (e) {
    if (prevBlob) localStorage.setItem("vn-device", prevBlob);
    else localStorage.removeItem("vn-device");
    throw e;
  }
}

async function unlockInner(phrase: string, opts: { createSpaceIfEmpty?: boolean } = {}): Promise<void> {
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
    freshSpace = true; // brand-new signup: an empty vault is expected
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
  // Re-seal the space to THIS device so future visits auto-unlock without the
  // phrase (a browser that joined an existing account has no device seal yet).
  if (!chosen.sealedKeys[identity.file.device.signPub]) {
    try {
      const sealedKeys = {
        ...chosen.sealedKeys,
        [identity.file.device.signPub]: toHex(sealBox(spaceKey, identity.deviceBox.pub)),
      };
      await client.createSpace({ id: chosen.id, name: chosen.id, createdAt: chosen.createdAt, sealedKeys });
    } catch { /* not fatal — auto-unlock just won't apply until next successful re-seal */ }
  }
  await enterApp();
}

/** Common tail once spaceKey/spaceId are set: load notes, show the app, start polling. */
async function enterApp(): Promise<void> {
  await refresh();
  try {
    for (const p of await client!.listPublic()) {
      publicMap.set(p.path, { slug: p.slug, author: p.author, theme: p.theme });
    }
  } catch { /* offline is fine */ }
  $("#lock").style.display = "none";
  $("#main").style.display = "flex";
  paintUserIdentity();
  void probeAdmin();
  startLiveSync();
  void maybeOAuthConsent().catch(() => undefined);
  // Poll stays as a safety net (proxies/sleep can drop the socket) — slow now
  // that the WebSocket carries instant updates.
  pollTimer = window.setInterval(() => void refresh().catch(() => undefined), 60_000);
}

// ---------- live sync: instant updates over WebSocket ----------
let liveSocket: WebSocket | null = null;
let liveClosed = false;
let liveRetry = 0;
let liveRefreshTimer: number | undefined;

function startLiveSync(): void {
  liveClosed = false;
  openLiveSocket();
}
function stopLiveSync(): void {
  liveClosed = true;
  if (liveSocket) {
    try { liveSocket.close(); } catch { /* ignore */ }
  }
  liveSocket = null;
}
function openLiveSocket(): void {
  if (liveClosed || !client || !spaceId) return;
  const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleLiveReconnect();
    return;
  }
  liveSocket = ws;
  ws.onopen = () => {
    liveRetry = 0;
    if (client && spaceId) ws.send(JSON.stringify(client.wsSubFrame([spaceId])));
  };
  ws.onmessage = (ev) => {
    let m: { type?: string };
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.type === "changed") {
      // Coalesce bursts (a multi-file sync) into one refresh.
      window.clearTimeout(liveRefreshTimer);
      liveRefreshTimer = window.setTimeout(() => void refresh().catch(() => undefined), 150);
    }
  };
  ws.onclose = () => {
    if (liveSocket === ws) liveSocket = null;
    scheduleLiveReconnect();
  };
  ws.onerror = () => {
    try { ws.close(); } catch { /* onclose handles retry */ }
  };
}
function scheduleLiveReconnect(): void {
  if (liveClosed) return;
  const delay = Math.min(30_000, 1000 * 2 ** liveRetry) + Math.floor(Math.random() * 500);
  liveRetry++;
  window.setTimeout(openLiveSocket, delay);
}

/**
 * Silent sign-in from the device key stored in localStorage — no phrase.
 * The space key is sealed to this device, so we open it directly. Returns
 * false if there's no stored device or it can't open any space (→ ask for phrase).
 */
async function autoUnlock(): Promise<boolean> {
  const stored = localStorage.getItem("vn-device");
  if (!stored) return false;
  try {
    const d = JSON.parse(stored) as { account: string; accountEnc?: string; signPriv: string; boxPriv: string; device: PrincipalIdentity["file"]["device"] };
    if (!d.accountEnc) return false; // pre-upgrade device blob — fall back to phrase once
    const id: PrincipalIdentity = {
      file: { accountSignPub: d.account, accountEncPub: d.accountEnc, device: d.device },
      deviceSign: signKeypairFromSeed(fromHex(d.signPriv)),
      deviceBox: boxKeypairFromSeed(fromHex(d.boxPriv)),
    };
    const c = new RelayClient("", id);
    await c.register();
    const spaces = await c.listSpaces();
    const chosen = spaces.find((sp) => sp.sealedKeys[id.file.device.signPub]);
    if (!chosen) return false;
    identity = id;
    client = c;
    spaceKey = openBox(fromHex(chosen.sealedKeys[id.file.device.signPub]), id.deviceBox);
    spaceId = chosen.id;
    await enterApp();
    return true;
  } catch {
    return false;
  }
}

// ---------- sync ----------
async function refresh(): Promise<void> {
  if (!client || !spaceKey || !spaceId) return;
  const updates = await client.pullAllUpdates(spaceId, cursor);
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
  if (changedCurrent && current) {
    if (!editor) openNote(current);
    else void takeRemoteIntoOpenNote(current).catch(() => undefined);
  }
}

async function pushNote(path: string, content: string): Promise<void> {
  if (!client || !spaceKey || !spaceId) throw new Error("Locked.");
  const payload: DocPayload = { v: 1, path, content, mtimeMs: Date.now() };
  const blob = encryptPayload(spaceKey, utf8(JSON.stringify(payload)), `vortex-doc-v1:${path}`);
  // Don't move the cursor to our own seq: another device's update may sit just below it.
  // Our push comes back on the next pull and is applied as a no-op.
  await client.pushUpdate(spaceId, path, blob);
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
      // Title stays visible; a 🔒 badge marks that the content is protected.
      const lock = isLockedContent(n.content) ? icon("lock", "listlock") + " " : "";
      html += `<a href="#" data-path="${esc(n.path)}" class="${current === n.path ? "active" : ""}">${lock}${esc(noteTitle(n))}</a>`;
    }
  }
  const emptyMsg = sessionPhrase && !freshSpace
    ? "This account has no notes. Expected yours? You signed in with a different set of 12 words — sign out (bottom-left) and use your main account's words."
    : "Nothing here yet — create a note with the + button";
  $("#list").innerHTML = html || `<div class="empty">${emptyMsg}</div>`;
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
let lockedCtx: { key: Uint8Array; meta: LockMeta } | null = null;
// Session cache of note body keys: unlocked notes stay unlocked until reload/lock.
const sessionKeys = new Map<string, { key: Uint8Array; meta: LockMeta }>();
// path → publish record; loaded at unlock, kept fresh on publish/unpublish.
const publicMap = new Map<string, { slug: string; author: string | null; theme: string }>();

/** Full content to persist = stashed frontmatter + (re-encrypted) editor body. */
function editorContent(): string {
  const bodyNow = editor ? editor.getMarkdown() : "";
  return editorFmPrefix + (lockedCtx ? wrapLockedBody(lockedCtx.meta, lockedCtx.key, bodyNow) : bodyNow);
}

function setSaveState(text: string): void {
  const el = document.getElementById("savestate");
  if (el) el.textContent = text;
}

async function flushSave(path: string): Promise<void> {
  if (!editor) return;
  const bodyNow = editor.getMarkdown();
  if (bodyNow === lastSavedBody) return; // compare plaintext body, not (re-encrypted) content
  const content = editorContent();
  saveState = "saving";
  setSaveState("saving…");
  try {
    await pushNote(path, content);
    lastSavedBody = bodyNow;
    lastSaved = content;
    republishIfPublic(path);
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
    `<button class="mbtn backbtn" id="backBtn">${icon('back')} notes</button>` +
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
      plain = openLockedBody(env, cached.key);
    } catch {
      sessionKeys.delete(path);
      return showLockScreen(path, n, env);
    }
    lockedCtx = { key: cached.key, meta: env };
    // Frontmatter prefix ends with the closing '---\n'; a blank line then the body.
    editorFmPrefix = n.content.slice(0, frontmatterEnd(n.content)) + "\n";
    mountEditor(path, n, plain, true);
    return;
  }
  lockedCtx = null;
  const { prefix, body } = splitForEditor(n.content);
  editorFmPrefix = prefix; // editorContent() = prefix + body === original, exactly
  mountEditor(path, n, body, false);
}

// Rich (Apple-Notes-style) by default; "Edit markdown" is per note, for the session.
const noteMode = new Map<string, EditorMode>();

const FORMATS: [FormatKind, string][] = [
  ["title", "Title"], ["heading", "Heading"], ["subheading", "Subheading"], ["body", "Body"],
  ["checklist", "Checklist"], ["bullets", "Bulleted list"], ["numbers", "Numbered list"],
  ["quote", "Quote"], ["code", "Code block"], ["bold", "Bold"], ["italic", "Italic"], ["strike", "Strikethrough"], ["link", "Link…"],
];

/** Frontmatter (plus the blank lines after it) stays aside; the editor edits the body. prefix + body === content. */
function splitForEditor(content: string): { prefix: string; body: string } {
  const fmEnd = frontmatterEnd(content);
  let prefix = content.slice(0, fmEnd);
  let body = content.slice(fmEnd);
  const lead = body.match(/^\n+/);
  if (lead) {
    prefix += lead[0];
    body = body.slice(lead[0].length);
  }
  return { prefix, body };
}

/**
 * Another device or an agent changed the note that's open. Take it in without
 * remounting: no local edits → show theirs; unsaved typing → diff3 merge (as the
 * CLI and the apps do); overlapping edits → keep ours, save theirs as a conflict copy.
 */
async function takeRemoteIntoOpenNote(path: string): Promise<void> {
  const n = notes.get(path);
  if (!editor || current !== path || !n || n.content === lastSaved) return;
  const localDirty = editor.getMarkdown() !== lastSavedBody;
  if (lockedCtx || findEnvelope(splitFrontmatter(n.content).body)) {
    // Locked notes: reload only when nothing local would be lost.
    if (!localDirty) {
      const top = $("#pane").scrollTop;
      openNote(path);
      $("#pane").scrollTop = top;
    }
    return;
  }
  const remote = n.content;
  let next = remote;
  if (localDirty) {
    const merged = tryDiff3(lastSaved, editorContent(), remote);
    if (merged !== null) next = merged;
    else {
      next = editorContent();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await pushNote(path.replace(/\.md$/, `.conflict-${stamp}.md`), remote).catch(() => undefined);
    }
  }
  const { prefix, body } = splitForEditor(next);
  editorFmPrefix = prefix;
  lastSavedBody = body;
  lastSaved = remote;
  editor.replaceBody(body);
  if (next !== remote) {
    await pushNote(path, next);
    lastSaved = next;
    renderList(($("#filter") as HTMLInputElement).value.trim().toLowerCase());
  }
}

/** Shared editor mount used by normal and unlocked-locked notes. */
function mountEditor(path: string, n: DocPayload, body: string, locked: boolean): void {
  lastSavedBody = body;
  const want = noteMode.get(path) ?? "rich";
  $("#note").innerHTML =
    noteHead(
      n,
      `<span class="aawrap"><button class="mbtn aabtn" id="aaBtn" title="Format" aria-haspopup="true" hidden>Aa</button>` +
        `<div class="aamenu" id="aaMenu" hidden>${FORMATS.map(([k, label]) => `<button class="menuitem" data-fmt="${k}">${label}</button>`).join("")}</div></span>` +
        `<span class="moremenu"><button class="mbtn" id="moreBtn">${icon('more')}</button>${noteMenuHtml(locked, path)}</span><button class="mbtn danger" id="delBtn">delete</button>`
    ) +
    `<p class="modenote" id="modeNote" hidden></p><div id="editor"></div>`;
  const scheduleSave = () => {
    saveState = "dirty";
    setSaveState("·");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSave(path), 1200);
  };
  const hooks = {
    onChange: scheduleSave,
    onSave: () => void flushSave(path),
    onBlur: () => void flushSave(path),
    onWikilink: (target: string) => openWikilink(target),
  };
  const host = $("#editor");
  let ed: NoteEditor | null = want === "rich" ? createRichEditor(host, body, hooks) : null;
  if (want === "rich" && !ed) {
    $("#modeNote").textContent = "This note uses markdown the rich view can't keep exactly, so it opens as markdown.";
    $("#modeNote").hidden = false;
  }
  if (!ed) ed = createSourceEditor(host, body, hooks);
  editor = ed;
  host.className = ed.mode === "rich" ? "rich" : "source";

  // Aa: formatting, the Apple Notes way (rich mode only).
  const aaBtn = $("#aaBtn") as HTMLButtonElement;
  const aaMenu = $("#aaMenu");
  aaBtn.hidden = ed.mode !== "rich";
  aaBtn.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
  aaBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    aaMenu.hidden = !aaMenu.hidden;
  });
  aaMenu.addEventListener("mousedown", (e) => e.preventDefault());
  aaMenu.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("[data-fmt]") as HTMLElement | null;
    if (!b) return;
    aaMenu.hidden = true;
    editor?.format(b.dataset.fmt as FormatKind);
  });
  document.addEventListener("click", (e) => {
    if (!aaMenu.hidden && !(e.target as HTMLElement).closest(".aawrap")) aaMenu.hidden = true;
  });

  const modeBtn = $("#modeBtn");
  modeBtn.innerHTML = ed.mode === "rich" ? `${icon("edit")} Edit markdown` : `${icon("read")} Rich text`;
  modeBtn.addEventListener("click", () => {
    const next: EditorMode = editor?.mode === "rich" ? "source" : "rich";
    noteMode.set(path, next);
    void closeEditor().then(() => openNote(path));
  });
  wireCommonNoteButtons(path);
  setMobileNoteOpen(true);
  renderList(($("#filter") as HTMLInputElement).value.trim().toLowerCase());
  $("#pane").scrollTop = 0;
}

/** [[Target]] → the note whose title or file name matches. */
function openWikilink(target: string): void {
  const t = target.trim().toLowerCase();
  const slug = slugify(target);
  for (const [p, nn] of notes) {
    const file = p.split("/").pop()!.replace(/\.md$/, "").toLowerCase();
    if (noteTitle(nn).toLowerCase() === t || p.replace(/\.md$/, "").toLowerCase() === t || file === t || file === slug) {
      void closeEditor().then(() => openNote(p));
      return;
    }
  }
  setSaveState(`No note named "${target}"`);
}

/** Prompt for the note password; on success cache it and reopen unlocked. */
function showLockScreen(path: string, n: DocPayload, env: LockEnvelope): void {
  lockedCtx = null;
  current = path;
  $("#note").innerHTML =
    noteHead(n, `<button class="mbtn danger" id="delBtn">delete</button>`) +
    `<div class="lockscreen">` +
    `<div class="lockicon">${icon('lock')}</div>` +
    `<p>This note is password-protected.</p>` +
    `<input id="unlockPw" type="password" placeholder="Password" autocomplete="off">` +
    `<button id="unlockGo" class="mbtn primary">Unlock</button>` +
    `<div id="unlockErr" class="lockerr"></div>` +
    (env.v === 2
      ? `<button id="phraseToggle" class="lostpw">Unlock with your 12 words instead</button>` +
        `<div id="phraseRow" hidden><textarea id="unlockPhrase" rows="2" placeholder="your 12 words" autocomplete="off"></textarea>` +
        `<button id="phraseGo" class="mbtn primary">Unlock with phrase</button></div>`
      : "") +
    `<button id="lostPwBtn" class="lostpw">Lost the password? Recover an earlier version</button></div>`;
  const finish = (key: Uint8Array): void => {
    sessionKeys.set(path, { key, meta: env });
    openNote(path);
  };
  const attempt = () => {
    const pw = ($("#unlockPw") as HTMLInputElement).value;
    if (!pw) return;
    $("#unlockErr").textContent = "Unlocking…";
    // scrypt is heavy; defer a tick so the label paints.
    window.setTimeout(() => {
      const key = keyFromPassword(env, pw);
      if (!key) {
        $("#unlockErr").textContent = "Wrong password.";
        return;
      }
      // Apple-Notes-style: reveal every other note that shares this password
      // for the rest of the session (each has its own salt, so re-derive).
      for (const [p, nn] of notes) {
        if (p === path || sessionKeys.has(p)) continue;
        const e2 = findEnvelope(splitFrontmatter(nn.content).body);
        if (!e2) continue;
        const k2 = keyFromPassword(e2, pw);
        if (k2) sessionKeys.set(p, { key: k2, meta: e2 });
      }
      // Older v1 lock (password-only): now that we hold the password AND the
      // plaintext, silently re-lock as v2 so the 12 words work from here on.
      if (env.v === 1 && identity) {
        try {
          const plain = openLockedBody(env, key);
          const { meta, key: nk } = makeLock(pw, fromHex(identity.file.accountEncPub));
          const fmEnd = frontmatterEnd(n.content);
          const prefix = fmEnd > 0 ? n.content.slice(0, fmEnd) + "\n" : "";
          void pushNote(path, prefix + wrapLockedBody(meta, nk, plain))
            .then(() => {
              sessionKeys.set(path, { key: nk, meta });
              openNote(path);
            })
            .catch(() => finish(key)); // offline: open with the v1 key, upgrade next time
          return;
        } catch { /* fall through to plain open */ }
      }
      finish(key);
    }, 20);
  };
  $("#unlockGo").addEventListener("click", attempt);
  document.getElementById("phraseToggle")?.addEventListener("click", () => {
    $("#phraseRow").hidden = false;
    ($("#unlockPhrase") as HTMLTextAreaElement).focus();
  });
  document.getElementById("phraseGo")?.addEventListener("click", () => {
    const words = ($("#unlockPhrase") as HTMLTextAreaElement).value.trim().toLowerCase().split(/\s+/).join(" ");
    if (!words) return;
    $("#unlockErr").textContent = "Unlocking…";
    window.setTimeout(() => {
      try {
        // Judge the words by whether they open THIS note — not by which
        // session account they match (after a rotation, an old-identity
        // device must still accept the new words).
        const account = accountFromPhrase(words);
        const key = keyFromAccount(env, account.box);
        if (!key) {
          $("#unlockErr").textContent =
            identity && toHex(account.sign.pub) !== identity.file.accountSignPub
              ? "Those words belong to a different account, and they don't open this note."
              : "This phrase can't open this note (it may have been locked before phrase-unlock existed).";
          return;
        }
        finish(key);
      } catch {
        $("#unlockErr").textContent = "That doesn't look like a valid 12-word phrase.";
      }
    }, 20);
  });
  $("#lostPwBtn").addEventListener("click", () => void openHistory(path).catch((e) => alert((e as Error).message)));
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

// ---------- version history ----------
// Every push is retained on the relay, encrypted with the space key — so any
// version from before a password was applied is recoverable without it.
interface HistVersion { seq: number; ts: string; author: string; content: string; deleted: boolean; locked: boolean }
let histVersions: HistVersion[] = [];
let histSel = -1;
let histPath = "";

async function openHistory(path: string): Promise<void> {
  if (!client || !spaceKey || !spaceId) return;
  histPath = path;
  histSel = -1;
  $("#histList").innerHTML = '<div class="tipsintro">Loading history…</div>';
  $("#histPreview").innerHTML = "";
  ($("#histRestore") as HTMLButtonElement).hidden = true;
  $("#histOverlay").hidden = false;
  const names = new Map<string, string>();
  try {
    for (const p of await client.listPrincipals()) names.set(p.signPub, p.name);
  } catch { /* names are a nicety, not required */ }
  const updates = await client.pullUpdates(spaceId, 0, path);
  histVersions = [];
  for (const u of updates) {
    try {
      const payload = JSON.parse(
        new TextDecoder().decode(decryptPayload(spaceKey, u.blob, `vortex-doc-v1:${u.doc}`))
      ) as DocPayload;
      histVersions.push({
        seq: u.seq,
        ts: u.ts,
        author: names.get(u.author) ?? u.author.slice(0, 8),
        content: payload.content ?? "",
        deleted: !!payload.deleted,
        locked: !payload.deleted && findEnvelope(splitFrontmatter(payload.content ?? "").body) !== null,
      });
    } catch { /* skip undecryptable updates */ }
  }
  histVersions.reverse(); // newest first
  const when = (iso: string) => `${iso.slice(0, 10)} · ${iso.slice(11, 16)}`;
  $("#histList").innerHTML = histVersions
    .map((v, i) => {
      const chip = v.deleted
        ? '<span class="tagchip">deleted</span>'
        : v.locked
          ? '<span class="tagchip">locked</span>'
          : '<span class="tagchip open">readable</span>';
      return `<button class="histrow" data-i="${i}">
        <span class="hwhen">${when(v.ts)}</span>${chip}
        <span class="hmeta">${esc(v.author)} · ${(v.content.length / 1000).toFixed(1)} KB</span>
      </button>`;
    })
    .join("") || '<div class="tipsintro">No history for this note yet.</div>';
}

function selectHistVersion(i: number): void {
  histSel = i;
  const v = histVersions[i];
  document.querySelectorAll(".histrow").forEach((el, j) => el.classList.toggle("sel", j === i));
  const restore = $("#histRestore") as HTMLButtonElement;
  if (v.deleted) {
    $("#histPreview").innerHTML = '<div class="tipsintro">This version is a deletion.</div>';
    restore.hidden = true;
    return;
  }
  if (v.locked) {
    $("#histPreview").innerHTML =
      '<div class="tipsintro">This version is password-protected — pick an earlier, readable one.</div>';
    restore.hidden = true;
    return;
  }
  const { body } = splitFrontmatter(v.content);
  $("#histPreview").innerHTML = `<article class="histarticle">${marked.parse(body, { async: false }) as string}</article>`;
  restore.hidden = false;
}

$("#histList").addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest(".histrow") as HTMLElement | null;
  if (row) selectHistVersion(Number(row.dataset.i));
});
$("#histRestore").addEventListener("click", () => {
  const v = histVersions[histSel];
  if (!v || !histPath) return;
  if (!confirm("Restore this version? The current version stays in history.")) return;
  void pushNote(histPath, v.content)
    .then(() => {
      sessionKeys.delete(histPath);
      $("#histOverlay").hidden = true;
      republishIfPublic(histPath);
      renderList();
      openNote(histPath);
    })
    .catch((e) => alert((e as Error).message));
});
$("#histClose").addEventListener("click", () => ($("#histOverlay").hidden = true));
$("#histOverlay").addEventListener("click", (e) => {
  if (e.target === $("#histOverlay")) $("#histOverlay").hidden = true;
});

/**
 * The readable content of a note — the live editor text if it's open, else the
 * stored content, decrypting a session-unlocked locked note. Returns null if a
 * locked note can't be read (caller shows a hint).
 */
function readableNoteContent(path: string): string | null {
  const n = notes.get(path);
  if (!n) return null;
  if (editor && current === path) return editorFmPrefix + editor.getMarkdown();
  const env = findEnvelope(splitFrontmatter(n.content).body);
  if (!env) return n.content;
  const cached = sessionKeys.get(path);
  if (!cached) return null;
  try {
    const fmEnd = frontmatterEnd(n.content);
    return (fmEnd > 0 ? n.content.slice(0, fmEnd) + "\n\n" : "") + openLockedBody(env, cached.key);
  } catch {
    return null;
  }
}

/** Copy a note's readable content to the clipboard. */
async function copyNoteContent(path: string): Promise<void> {
  const content = readableNoteContent(path);
  if (content === null) return void alert("Unlock this note first to copy its content.");
  try {
    await navigator.clipboard.writeText(content);
    const btn = document.getElementById("copyBtn");
    if (btn) {
      const prev = btn.innerHTML;
      btn.innerHTML = `${icon("check")} Copied`;
      window.setTimeout(() => { btn.innerHTML = prev; }, 1500);
    }
  } catch {
    alert("Couldn't access the clipboard.");
  }
}

/** Save a note to a local file — always the READABLE form, never the envelope. */
function downloadNote(path: string, ext: "md" | "txt"): void {
  const content = readableNoteContent(path);
  if (content === null) return void alert("Unlock this note first to download its content.");
  const n = notes.get(path);
  const name = ((n && noteTitle(n)) || path.split("/").pop() || "note").replace(/[\\/:*?"<>|]/g, "-");
  const blob = new Blob([content], { type: ext === "md" ? "text/markdown" : "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function noteMenuHtml(locked: boolean, path?: string): string {
  const isPublic = path ? publicMap.has(path) : false;
  return (
    `<div class="notemenu" id="noteMenu" hidden>` +
    `<button class="menuitem" id="renameBtn">${icon('edit')} Rename / move</button>` +
    `<button class="menuitem" id="dupBtn">${icon('copy')} Duplicate</button>` +
    `<button class="menuitem" id="modeBtn"></button>` +
    `<button class="menuitem" id="histBtn">${icon('refresh')} History</button>` +
    `<button class="menuitem" id="copyBtn">${icon('copy')} Copy content</button>` +
    `<button class="menuitem" id="dlMdBtn">${icon('read')} Download .md</button>` +
    `<button class="menuitem" id="dlTxtBtn">${icon('read')} Download .txt</button>` +
    (locked
      ? `<button class="menuitem" id="lockNowBtn">${icon('lock')} Lock now</button>` +
        `<button class="menuitem" id="unlockPermBtn">${icon('unlock')} Remove password</button>`
      : `<button class="menuitem" id="lockBtnItem">${icon('lock')} Password-protect</button>` +
        `<button class="menuitem" id="pubBtn">${icon('globe')} ${isPublic ? "Public link\u2026" : "Make public"}</button>`) +
    `</div>`
  );
}

/** Modal masked-password prompt. Resolves to the password, or null if cancelled. */
function promptPassword(opts: { title: string; hint?: string; confirm?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    const ov = $("#pwOverlay");
    const inp = $("#pwInput") as HTMLInputElement;
    const conf = $("#pwConfirm") as HTMLInputElement;
    const go = $("#pwGo");
    const close = $("#pwClose");
    $("#pwTitle").textContent = opts.title;
    $("#pwHint").textContent = opts.hint ?? "";
    inp.value = "";
    conf.value = "";
    conf.hidden = !opts.confirm;
    $("#pwErr").textContent = "";
    ov.hidden = false;
    setTimeout(() => inp.focus(), 10);
    const cleanup = () => {
      ov.hidden = true;
      go.removeEventListener("click", onGo);
      close.removeEventListener("click", onCancel);
      ov.removeEventListener("click", onBackdrop);
      inp.removeEventListener("keydown", onKey);
      conf.removeEventListener("keydown", onKey);
    };
    const onGo = () => {
      const v = inp.value;
      if (!v) return void ($("#pwErr").textContent = "Enter a password.");
      if (opts.confirm && v !== conf.value) return void ($("#pwErr").textContent = "Passwords don't match.");
      cleanup();
      resolve(v);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const onBackdrop = (e: Event) => {
      if (e.target === ov) onCancel();
    };
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).key === "Enter") onGo();
      else if ((e as KeyboardEvent).key === "Escape") onCancel();
    };
    go.addEventListener("click", onGo);
    close.addEventListener("click", onCancel);
    ov.addEventListener("click", onBackdrop);
    inp.addEventListener("keydown", onKey);
    conf.addEventListener("keydown", onKey);
  });
}

/** Lock the currently-open note with a new password (must be open/unlocked). */
async function lockNote(path: string): Promise<void> {
  if (!editor) return;
  const pw = await promptPassword({
    title: "Password-protect this note",
    hint: "Your 12-word phrase can also unlock it — and History keeps every earlier version.",
    confirm: true,
  });
  if (!pw) return;
  // v2: random body key wrapped for the password AND sealed to the account,
  // so the 12-word phrase can always open the note.
  const { meta, key } = makeLock(pw, identity ? fromHex(identity.file.accountEncPub) : undefined);
  const plainBody = editor.getMarkdown();
  lockedCtx = { key, meta };
  sessionKeys.set(path, { key, meta });
  lastSavedBody = plainBody; // body itself unchanged; only its stored form is now encrypted
  await pushNote(path, editorContent());
  lastSaved = notes.get(path)?.content ?? "";
  openNote(path);
}

/** Remove the password from the currently-open (unlocked) note. */
async function unlockPermanent(path: string): Promise<void> {
  if (!editor) return;
  const plainBody = editor.getMarkdown();
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
    document.getElementById("lockNowBtn")?.addEventListener("click", () => {
      void closeEditor().then(() => {
        sessionKeys.delete(path);
        openNote(path); // envelope + no session key → password screen
      });
    });
    document.getElementById("pubBtn")?.addEventListener("click", () => openPublishModal(path));
    document.getElementById("histBtn")?.addEventListener("click", () => void openHistory(path).catch((e) => alert((e as Error).message)));
    document.getElementById("copyBtn")?.addEventListener("click", () => void copyNoteContent(path));
    document.getElementById("dlMdBtn")?.addEventListener("click", () => downloadNote(path, "md"));
    document.getElementById("dlTxtBtn")?.addEventListener("click", () => downloadNote(path, "txt"));
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
    const bodyNow = editor.getMarkdown();
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

// ---------- public notes ----------
function bodyForPublish(path: string): string | null {
  const n = notes.get(path);
  if (!n || isLockedContent(n.content)) return null;
  return splitFrontmatter(n.content).body.replace(/^\n+/, "");
}

function openPublishModal(path: string): void {
  const n = notes.get(path);
  if (!n) return;
  if (isLockedContent(n.content) && !sessionKeys.has(path)) return alert("Unlock the note first.");
  const existing = publicMap.get(path);
  const ov = $("#pubOverlay");
  $("#pubTitle").textContent = existing ? "Public link" : "Make this note public";
  ($("#pubName") as HTMLInputElement).value = localStorage.getItem("vn-authorname") ?? "";
  if (existing) {
    (document.querySelector(`input[name="pubTheme"][value="${existing.theme}"]`) as HTMLInputElement | null)?.click?.();
    (document.querySelector(`input[name="pubAuthor"][value="${existing.author ? "name" : "anon"}"]`) as HTMLInputElement).checked = true;
    $("#pubLinkRow").hidden = false;
    const url = `${location.origin}/p/${existing.slug}`;
    ($("#pubLink") as HTMLAnchorElement).href = url;
    $("#pubLink").textContent = url;
    ($("#pubGo") as HTMLButtonElement).textContent = "Update";
    ($("#pubOff") as HTMLButtonElement).hidden = false;
  } else {
    $("#pubLinkRow").hidden = true;
    ($("#pubGo") as HTMLButtonElement).textContent = "Publish";
    ($("#pubOff") as HTMLButtonElement).hidden = true;
  }
  $("#pubErr").textContent = "";
  ov.hidden = false;

  const onGo = () => {
    const anon = (document.querySelector('input[name="pubAuthor"]:checked') as HTMLInputElement).value === "anon";
    const name = ($("#pubName") as HTMLInputElement).value.trim();
    if (!anon && !name) return void ($("#pubErr").textContent = "Enter a display name or pick Anonymous.");
    if (!anon) localStorage.setItem("vn-authorname", name);
    const theme = (document.querySelector('input[name="pubTheme"]:checked') as HTMLInputElement).value;
    const markdown = bodyForPublish(path);
    if (markdown === null || !client) return void ($("#pubErr").textContent = "Cannot publish this note.");
    $("#pubErr").textContent = "Publishing…";
    void client
      .publishNote({ slug: existing?.slug, path, title: noteTitle(n), author: anon ? null : name, theme, markdown })
      .then((slug) => {
        publicMap.set(path, { slug, author: anon ? null : name, theme });
        cleanup();
        openPublishModal(path); // reopen showing the link
      })
      .catch((e) => ($("#pubErr").textContent = (e as Error).message));
  };
  const onOff = () => {
    if (!existing || !client) return;
    $("#pubErr").textContent = "Removing…";
    void client
      .unpublishNote(existing.slug)
      .then(() => {
        publicMap.delete(path);
        cleanup();
        if (current === path) openNote(path);
      })
      .catch((e) => ($("#pubErr").textContent = (e as Error).message));
  };
  const onCopy = () => {
    void navigator.clipboard.writeText(($("#pubLink") as HTMLAnchorElement).href).then(() => {
      $("#pubCopy").textContent = "copied";
      setTimeout(() => ($("#pubCopy").textContent = "copy"), 1500);
    });
  };
  const onClose = () => cleanup();
  const onBackdrop = (e: Event) => { if (e.target === ov) cleanup(); };
  function cleanup(): void {
    ov.hidden = true;
    $("#pubGo").removeEventListener("click", onGo);
    $("#pubOff").removeEventListener("click", onOff);
    $("#pubCopy").removeEventListener("click", onCopy);
    $("#pubClose").removeEventListener("click", onClose);
    ov.removeEventListener("click", onBackdrop);
  }
  $("#pubGo").addEventListener("click", onGo);
  $("#pubOff").addEventListener("click", onOff);
  $("#pubCopy").addEventListener("click", onCopy);
  $("#pubClose").addEventListener("click", onClose);
  ov.addEventListener("click", onBackdrop);
}

/** Auto-republish: called after each successful save of a published note. */
function republishIfPublic(path: string): void {
  const pub = publicMap.get(path);
  const n = notes.get(path);
  if (!pub || !n || !client) return;
  const markdown = bodyForPublish(path);
  if (markdown === null) return; // became locked — leave the public copy as-is
  void client
    .publishNote({ slug: pub.slug, path, title: noteTitle(n), author: pub.author, theme: pub.theme, markdown })
    .catch(() => undefined); // transient failures retry on next save
}

async function deleteNote(path: string): Promise<void> {
  if (!client || !spaceKey || !spaceId) throw new Error("Locked.");
  const pub = publicMap.get(path);
  if (pub) {
    await client.unpublishNote(pub.slug).catch(() => undefined);
    publicMap.delete(path);
  }
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
const tipsOverlay = $("#tipsOverlay");

/** Certify an agent key for this space, seal the space key to it, and register it. */
async function grantAgent(signPub: Uint8Array, encPub: Uint8Array, name: string, mode: "ro" | "rw") {
  const cert = certifyAgent(identity!.deviceSign, signPub, encPub, name, [spaceId!], mode);
  // grant: add the agent's sealed space key and push the updated membership
  const spaces = await client!.listSpaces();
  const space = spaces.find((s) => s.id === spaceId)!;
  const sealedKeys = { ...space.sealedKeys, [cert.signPub]: toHex(sealBox(spaceKey!, encPub)) };
  await client!.createSpace({ id: spaceId!, name: spaceId!, createdAt: space.createdAt, sealedKeys });
  // register the agent so it can authenticate right away
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
  return cert;
}

/** A cloud agent whose key the relay holds: the hosted MCP connector behind a chat app. */
async function createChatConnector(name: string, mode: "ro" | "rw"): Promise<{ token: string; path: string }> {
  const sign = randomSignKeypair();
  const box = randomBoxKeypair();
  const cert = await grantAgent(sign.pub, box.pub, name, mode);
  const keys = new Uint8Array(64);
  keys.set(sign.priv, 0);
  keys.set(box.priv, 32);
  return client!.createConnector(cert.signPub, keys);
}

// --- a chat app signing in over OAuth (/oauth/authorize sends the browser to /app?oauth=<id>) ---
const oauthOverlay = $("#oauthOverlay");
async function maybeOAuthConsent(): Promise<void> {
  const id = new URLSearchParams(location.search).get("oauth");
  if (!id || !/^[0-9a-f]{32}$/.test(id)) return;
  history.replaceState(null, "", "/app"); // a reload shouldn't re-prompt
  const res = await fetch(`/v1/oauth/request/${id}`);
  const info = (await res.json().catch(() => ({}))) as { clientName?: string; redirectHost?: string; denyUrl?: string; error?: string };
  oauthOverlay.hidden = false;
  if (!res.ok || !info.clientName) {
    $("#oauthApp").textContent = "A chat app";
    $("#oauthStatus").textContent = info.error ?? "This sign-in request expired. Start again from the app.";
    ($("#oauthApprove") as HTMLButtonElement).disabled = true;
    $("#oauthCancel").onclick = () => (oauthOverlay.hidden = true);
    return;
  }
  $("#oauthApp").textContent = info.clientName;
  $("#oauthHost").textContent = info.redirectHost ?? "";
  const syncWrites = () => {
    const ro = (document.querySelector('input[name="oauthMode"]:checked') as HTMLInputElement).value === "ro";
    $("#oauthWrites").hidden = ro;
  };
  document.querySelectorAll('input[name="oauthMode"]').forEach((r) => r.addEventListener("change", syncWrites));
  $("#oauthCancel").onclick = () => location.assign(info.denyUrl!);
  $("#oauthApprove").onclick = () => {
    const mode = (document.querySelector('input[name="oauthMode"]:checked') as HTMLInputElement).value as "ro" | "rw";
    ($("#oauthApprove") as HTMLButtonElement).disabled = true;
    $("#oauthStatus").textContent = "Connecting…";
    void (async () => {
      const { token } = await createChatConnector(info.clientName!, mode);
      const { redirect } = await client!.approveOAuth(id, token);
      $("#oauthStatus").textContent = `Connected. Returning to ${info.redirectHost}…`;
      location.assign(redirect);
    })().catch((e) => {
      ($("#oauthApprove") as HTMLButtonElement).disabled = false;
      $("#oauthStatus").textContent = (e as Error).message;
    });
  };
}

// --- connect a chat app: a cloud agent whose key the relay holds (hosted MCP URL) ---
const chatOverlay = $("#chatOverlay");
$("#chatBtn").addEventListener("click", () => {
  if (!identity || !spaceKey) return alert("Unlock first.");
  ($("#chatName") as HTMLInputElement).value = "";
  $("#chatStep1").hidden = false;
  $("#chatStep2").hidden = true;
  $("#chatStatus").textContent = "";
  chatOverlay.hidden = false;
  ($("#chatName") as HTMLInputElement).focus();
});
$("#chatClose").addEventListener("click", () => (chatOverlay.hidden = true));
chatOverlay.addEventListener("click", (e) => {
  if (e.target === chatOverlay) chatOverlay.hidden = true;
});
$("#chatCreate").addEventListener("click", () => {
  if (!identity || !client || !spaceKey || !spaceId) return;
  const name = ($("#chatName") as HTMLInputElement).value.trim() || "Chat app";
  const mode = (document.querySelector('input[name="chatMode"]:checked') as HTMLInputElement).value as "ro" | "rw";
  $("#chatStatus").textContent = "Creating…";
  void (async () => {
    const { path } = await createChatConnector(name, mode);
    $("#chatUrl").textContent = location.origin + path;
    $("#chatStep1").hidden = true;
    $("#chatStep2").hidden = false;
    $("#chatStatus").textContent = "";
    if (!agentsOverlay.hidden) void openAgentsPanel();
  })().catch((e) => ($("#chatStatus").textContent = (e as Error).message));
});
$("#chatCopy").addEventListener("click", () => {
  void navigator.clipboard.writeText($("#chatUrl").textContent ?? "").then(() => ($("#chatCopy").textContent = "Copied"));
});

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
    const cert = await grantAgent(fromHex(req.signPub), fromHex(req.encPub), req.name, mode);
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
$("#acctIdCopy").addEventListener("click", () => {
  void navigator.clipboard.writeText($("#acctId").textContent ?? "").then(() => ($("#acctIdCopy").textContent = "Copied"));
});
// --- account & recovery: reveal the session phrase (never persisted) ---
const acctOverlay = $("#acctOverlay");
$("#acctBtn").addEventListener("click", () => {
  if (!identity) return alert("Unlock first.");
  $("#acctFp").textContent = identity.file.accountSignPub.slice(0, 16) + "…";
  $("#acctId").textContent = identity.file.accountSignPub;
  $("#acctIdCopy").textContent = "Copy";
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
// ---------- account rotation: fresh 12 words, same notes ----------
// The signed-in session holds the space key, so it can re-seal everything to a
// brand-new account and hand ownership over. Old device/agent seals stay, so
// every signed-in principal keeps working; only the OLD PHRASE dies.
let rotPhrase = "";
$("#rotBtn").addEventListener("click", () => {
  rotPhrase = generatePhrase();
  $("#rotPhrase").textContent = rotPhrase;
  ($("#rotSaved") as HTMLInputElement).checked = false;
  ($("#rotGo") as HTMLButtonElement).disabled = true;
  $("#rotStatus").textContent = "";
  $("#rotFlow").hidden = false;
});
$("#rotSaved").addEventListener("change", (e) => {
  ($("#rotGo") as HTMLButtonElement).disabled = !(e.target as HTMLInputElement).checked;
});
$("#rotGo").addEventListener("click", () => {
  void rotateAccount().catch((e) => ($("#rotStatus").textContent = "Failed: " + (e as Error).message + " — nothing was lost; you can retry."));
});
async function rotateAccount(): Promise<void> {
  if (!client || !identity || !spaceKey || !spaceId || !rotPhrase) return;
  const status = (t: string) => ($("#rotStatus").textContent = t);
  status("Deriving your new keys…");
  const newAccount = accountFromPhrase(rotPhrase);
  const ndSign = randomSignKeypair();
  const ndBox = randomBoxKeypair();
  const device = certifyDevice(newAccount, ndSign, ndBox, browserDeviceName());
  const newIdentity: PrincipalIdentity = {
    file: { accountSignPub: toHex(newAccount.sign.pub), accountEncPub: toHex(newAccount.box.pub), device },
    deviceSign: ndSign,
    deviceBox: ndBox,
  };
  status("Registering this browser under the new account…");
  const newClient = new RelayClient("", newIdentity);
  await newClient.register();
  status("Re-sealing your space…");
  const sp = (await client.listSpaces()).find((s) => s.id === spaceId);
  if (!sp) throw new Error("Space not found");
  const sealedKeys = { ...sp.sealedKeys };
  delete sealedKeys[identity.file.accountSignPub]; // the old phrase stops opening anything
  sealedKeys[newIdentity.file.accountSignPub] = toHex(sealBox(spaceKey, newAccount.box.pub));
  sealedKeys[device.signPub] = toHex(sealBox(spaceKey, ndBox.pub));
  await client.createSpace({ id: sp.id, name: sp.id, createdAt: sp.createdAt, sealedKeys });
  status("Transferring ownership…");
  await client.transferSpace(spaceId, newIdentity.file.accountSignPub);
  status("Switching this session over…");
  localStorage.setItem(
    "vn-device",
    JSON.stringify({
      account: newIdentity.file.accountSignPub,
      accountEnc: newIdentity.file.accountEncPub,
      signPriv: toHex(ndSign.priv),
      boxPriv: toHex(ndBox.priv),
      device,
    })
  );
  identity = newIdentity;
  client = newClient;
  sessionPhrase = rotPhrase;
  // Re-open live sync under the new device identity.
  stopLiveSync();
  startLiveSync();
  // Locked notes we can currently open: re-seal their body keys to the new
  // account so the NEW words unlock them. Still-locked ones keep password-only.
  let resealed = 0;
  for (const [p, cached] of sessionKeys) {
    const n = notes.get(p);
    if (!n) continue;
    const env = findEnvelope(splitFrontmatter(n.content).body);
    if (!env || env.v !== 2) continue;
    try {
      const plain = openLockedBody(env, cached.key);
      const meta: LockMeta = { ...env, sealedAcct: sealBox(cached.key, newAccount.box.pub) };
      const fmEnd = frontmatterEnd(n.content);
      const prefix = fmEnd > 0 ? n.content.slice(0, fmEnd) + "\n" : "";
      await pushNote(p, prefix + wrapLockedBody(meta, cached.key, plain));
      sessionKeys.set(p, { key: cached.key, meta });
      resealed++;
    } catch { /* leave that note as-is */ }
  }
  rotPhrase = "";
  paintUserIdentity();
  void probeAdmin();
  $("#rotFlow").hidden = true;
  status("");
  alert(
    "Done — your account now answers ONLY to the new 12 words.\n\n" +
      "\u2022 Notes, devices, and agents: untouched, all working\n" +
      (resealed ? "\u2022 " + resealed + " locked note(s) re-keyed to the new words\n" : "") +
      "\u2022 The old words are dead — destroy any copies\n\n" +
      "Keep the new words safe: they are now the only recovery."
  );
}
$("#acctClose").addEventListener("click", () => (acctOverlay.hidden = true));
acctOverlay.addEventListener("click", (e) => {
  if (e.target === acctOverlay) acctOverlay.hidden = true;
});

$("#lockAllBtn").addEventListener("click", () => {
  void closeEditor().then(() => {
    sessionKeys.clear();
    if (current) openNote(current);
    renderList(($("#filter") as HTMLInputElement).value.trim().toLowerCase());
  });
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
// --- bottom-left user menu (opens upward) ---
const userMenu = $("#userMenu");
$("#userBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const opening = (userMenu as HTMLElement & { hidden: boolean }).hidden;
  if (opening) void refreshUserMenu();
  (userMenu as HTMLElement & { hidden: boolean }).hidden = !opening;
});
document.addEventListener("click", (e) => {
  if (!userMenu.hidden && !(e.target as HTMLElement).closest(".usermenuwrap")) userMenu.hidden = true;
});
userMenu.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest(".menuitem:not(.static)")) userMenu.hidden = true;
});
$("#nameBtn").addEventListener("click", () => {
  const cur = localStorage.getItem("vn-authorname") ?? "";
  const name = prompt("Display name (used on public notes):", cur);
  if (name !== null) {
    localStorage.setItem("vn-authorname", name.trim());
    paintUserIdentity();
  }
});
$("#agentsBtn").addEventListener("click", () => void openAgentsPanel());

// --- admin stats (menu item appears only if the relay says we're admin) ---
const adminOverlay = $("#adminOverlay");
async function probeAdmin(): Promise<void> {
  if (!client) return;
  try {
    await client.getAdminStats();
    ($("#adminBtn") as HTMLElement).hidden = false;
  } catch { /* not admin — item stays hidden */ }
}
async function renderAdmin(): Promise<void> {
  if (!client) return;
  const [st, accts] = await Promise.all([client.getAdminStats(), client.getAdminAccounts()]);
  const s = st as Record<string, number>;
  const card = (label: string, val: string | number, hot = false) =>
    `<div class="statcard"><b${hot ? ' style="color:var(--accent)"' : ""}>${val}</b><span>${label}</span></div>`;
  $("#adminGrid").innerHTML =
    card("accounts", s.accounts) +
    card("new · untagged", s.newAccounts, s.newAccounts > 0) +
    card("devices", s.devices) +
    card("agents", s.agents) +
    card("updates · 24h", s.updates24h) +
    card("updates · 7d", s.updates7d) +
    card("stored", (s.bytesStored / 1e6).toFixed(1) + " MB") +
    card("public notes", s.publicNotes) +
    card("pending pairings", s.pendingPairings) +
    card("spaces", s.spaces);
  const byCountry = ((st as { byCountry?: { country: string; n: number }[] }).byCountry ?? []);
  $("#adminCountries").innerHTML = byCountry.length
    ? byCountry.map((c) => `<span class="ctag">${esc(c.country)} <b>${c.n}</b></span>`).join("")
    : '<span class="ctag">no data yet</span>';
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "never");
  $("#adminAccts").innerHTML = accts
    .map((a) => {
      const chip = a.tag
        ? `<span class="tagchip">${esc(a.tag)}</span>`
        : '<span class="tagchip new">new</span>';
      const devices = a.principals.filter((p) => p.kind !== "agent").map((p) => esc(p.name)).join(", ");
      const agents = a.principals.filter((p) => p.kind === "agent").map((p) => esc(p.name)).join(", ");
      const pubs = a.publicTitles.length ? ` · public: ${a.publicTitles.map(esc).join(", ")}` : "";
      return `<div class="adrow" data-acct="${esc(a.account)}">
        <div class="l1"><code>${esc(a.account.slice(0, 8))}</code>${chip}
          <div class="tagbtns">
            <button data-tag="mine">mine</button><button data-tag="test">test</button>${a.tag ? '<button data-tag="">clear</button>' : ""}
          </div></div>
        <div class="meta">${day(a.firstSeen)} → ${day(a.lastActive)} · ${a.updates} upd · ${(a.bytesUsed / 1000).toFixed(1)} KB${a.country ? " · " + esc(a.country) : ""}<br>
          ${devices || "no devices"}${agents ? ` · agents: ${agents}` : ""}${pubs}</div>
      </div>`;
    })
    .join("") || '<div class="tipsintro">No accounts yet.</div>';
}
$("#adminBtn").addEventListener("click", () => {
  if (!client) return;
  $("#adminGrid").innerHTML = '<div class="tipsintro">Loading…</div>';
  $("#adminAccts").innerHTML = "";
  adminOverlay.hidden = false;
  void renderAdmin().catch((e) => ($("#adminGrid").innerHTML = `<div class="lockerr">${esc((e as Error).message)}</div>`));
});
$("#adminAccts").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("[data-tag]") as HTMLElement | null;
  if (!btn || !client) return;
  const acct = (btn.closest(".adrow") as HTMLElement).dataset.acct!;
  void client.setAdminTag(acct, btn.dataset.tag || null)
    .then(() => renderAdmin())
    .catch((err) => alert((err as Error).message));
});
$("#adminClose").addEventListener("click", () => (adminOverlay.hidden = true));
adminOverlay.addEventListener("click", (e) => { if (e.target === adminOverlay) adminOverlay.hidden = true; });

$("#refreshBtn").addEventListener("click", () => void refresh().catch((e) => alert((e as Error).message)));
$("#filter").addEventListener("input", (e) => renderList((e.target as HTMLInputElement).value.trim().toLowerCase()));
$("#lockBtn").addEventListener("click", () => {
  if (!confirm("Sign out on this device? You'll need your recovery phrase to sign back in.")) return;
  sessionPhrase = "";
  sessionKeys.clear();
  localStorage.removeItem("vn-device"); // forget the device key → next visit asks for the phrase
  clearInterval(pollTimer);
  stopLiveSync();
  location.reload();
});

/** Deterministic 5x5 mirrored identicon from the account key (flat, monochrome). */
function identiconSvg(seedHex: string): string {
  let cells = "";
  for (let i = 0; i < 15; i++) {
    const on = parseInt(seedHex[i % seedHex.length], 16) % 2 === 0;
    if (!on) continue;
    const col = Math.floor(i / 5), row = i % 5;
    for (const c of [col, 4 - col]) cells += `<rect x="${c * 20}" y="${row * 20}" width="20" height="20"/>`;
  }
  return `<svg viewBox="0 0 100 100" fill="var(--accent)" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`;
}
function paintUserIdentity(): void {
  if (!identity) return;
  $("#userAvatar").innerHTML = identiconSvg(identity.file.accountSignPub);
  const name = localStorage.getItem("vn-authorname");
  $("#userLabel").textContent = name || fingerprint(fromHex(identity.file.accountSignPub));
  $("#umName").textContent = name || "not set";
}
async function refreshUserMenu(): Promise<void> {
  paintUserIdentity();
  if (!client) return;
  try {
    const u = await client.getUsage();
    $("#umStorage").textContent = u.quotaBytes
      ? `${(u.bytesUsed / 1e6).toFixed(1)} / ${Math.round(u.quotaBytes / 1e6)} MB`
      : `${(u.bytesUsed / 1e6).toFixed(1)} MB`;
  } catch {
    $("#umStorage").textContent = "—";
  }
}

// --- agents & devices panel ---
const agentsOverlay = $("#agentsOverlay");
async function openAgentsPanel(): Promise<void> {
  if (!client) return;
  $("#agentsErr").textContent = "";
  $("#agentsList").innerHTML = '<div class="tipsintro">Loading…</div>';
  agentsOverlay.hidden = false;
  try {
    const [principals, connectors] = await Promise.all([client.listPrincipals(), client.listConnectors().catch(() => [])]);
    const cloud = new Map(connectors.map((c) => [c.agentSignPub, c.token]));
    const rows = principals
      .map((p) => {
        const isSelf = p.signPub === identity?.file.device.signPub;
        const kind = p.kind === "agent" ? "agent" : "device";
        const token = cloud.get(p.signPub);
        const scope = (token ? "chat connector · relay holds its key · " : "") +
          (p.kind === "agent" ? `${p.mode === "ro" ? "read-only" : "read+write"} · ${(p.spaces ?? []).length} space${(p.spaces ?? []).length === 1 ? "" : "s"}` : "full access");
        return (
          `<div class="agentrow">${icon(kind)}` +
          `<div class="col"><span class="an">${esc(p.name)}${isSelf ? " (this device)" : ""}</span>` +
          `<span class="am">${esc(scope)} · ${p.signPub.slice(0, 10)}…</span></div>` +
          (token ? `<button class="mbtn" data-copyurl="${esc(location.origin + "/mcp/" + token)}">Copy URL</button>` : "") +
          (isSelf ? "" : `<button class="mbtn danger" data-revoke="${esc(p.signPub)}" data-name="${esc(p.name)}">Revoke</button>`) +
          `</div>`
        );
      })
      .join("");
    $("#agentsList").innerHTML = rows || '<div class="tipsintro">No devices or agents yet.</div>';
    $("#agentsList")
      .querySelectorAll("[data-copyurl]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          void navigator.clipboard.writeText((b as HTMLElement).dataset.copyurl!).then(() => (b.textContent = "Copied"));
        })
      );
    $("#agentsList")
      .querySelectorAll("[data-revoke]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          const pub = (b as HTMLElement).dataset.revoke!;
          const name = (b as HTMLElement).dataset.name!;
          if (!confirm(`Revoke "${name}"? It will lose access immediately.`)) return;
          $("#agentsErr").textContent = "Revoking…";
          void client!
            .revokePrincipal(pub)
            .then(() => openAgentsPanel())
            .catch((e) => ($("#agentsErr").textContent = (e as Error).message));
        })
      );
  } catch (e) {
    $("#agentsList").innerHTML = "";
    $("#agentsErr").textContent = (e as Error).message;
  }
}
$("#agentsClose").addEventListener("click", () => (agentsOverlay.hidden = true));
agentsOverlay.addEventListener("click", (e) => {
  if (e.target === agentsOverlay) agentsOverlay.hidden = true;
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

// --- PWA: register the offline service worker (harmless if unsupported) ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* offline install is best-effort */ });
  });
}

// --- startup: stay signed in. Try the stored device key before asking for the phrase. ---
const lockEl = $("#lock");
if (localStorage.getItem("vn-device")) {
  lockEl.style.visibility = "hidden"; // avoid a flash of the phrase screen
  void autoUnlock()
    .then((ok) => {
      lockEl.style.visibility = "";
      if (!ok) return; // no stored session worked → the phrase screen is already shown
    })
    .catch(() => (lockEl.style.visibility = ""));
}
