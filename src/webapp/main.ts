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
      html += `<a href="#" data-path="${esc(n.path)}" class="${current === n.path ? "active" : ""}">${esc(noteTitle(n))}</a>`;
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

function setSaveState(text: string): void {
  const el = document.getElementById("savestate");
  if (el) el.textContent = text;
}

async function flushSave(path: string): Promise<void> {
  if (!editor) return;
  const content = editor.state.doc.toString();
  if (content === lastSaved) return;
  saveState = "saving";
  setSaveState("saving…");
  try {
    await pushNote(path, content);
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

function noteHead(n: DocPayload, buttons: string): string {
  return (
    `<div class="notehead"><div class="meta">` +
    `<button class="mbtn backbtn" id="backBtn">‹ notes</button>` +
    `<span class="path">${esc(n.path)}</span><span id="savestate"></span>` +
    buttons +
    `</div><h1>${esc(noteTitle(n))}</h1></div>`
  );
}

/** Default view: the live editor — the note IS the editing surface. */
function openNote(path: string): void {
  const n = notes.get(path);
  if (!n) return;
  void closeEditor();
  current = path;
  lastSaved = n.content;
  $("#note").innerHTML =
    noteHead(n, `<button class="mbtn" id="readBtn">read</button><button class="mbtn danger" id="delBtn">delete</button>`) +
    `<div id="cm"></div>`;
  const scheduleSave = () => {
    saveState = "dirty";
    setSaveState("·");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSave(path), 1200);
  };
  editor = new EditorView({
    doc: n.content,
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

/** Reading view: fully rendered markdown; tap the text to go back to live editing. */
function openReader(path: string): void {
  const n = notes.get(path);
  if (!n) return;
  void closeEditor();
  current = path;
  const { body } = splitFrontmatter(n.content);
  $("#note").innerHTML =
    noteHead(n, `<button class="mbtn primary" id="liveBtn">edit</button><button class="mbtn danger" id="delBtn">delete</button>`) +
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

function wireCommonNoteButtons(path: string): void {
  $("#backBtn").addEventListener("click", () => {
    void closeEditor();
    setMobileNoteOpen(false);
  });
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
    const content = editor.state.doc.toString();
    editor.destroy();
    editor = null;
    if (content !== lastSaved) {
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
