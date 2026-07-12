/**
 * The hosted web app, served by the relay at /app.
 *
 * Everything cryptographic happens in this browser tab: the recovery phrase
 * is typed into a client-side form, keys are derived here, the space key is
 * unsealed here, and note payloads are decrypted here. The relay only ever
 * sees the same signed requests and ciphertext blobs any device sends.
 *
 * v0 scope: unlock → browser enrolls itself as a device → list + read notes
 * (rendered markdown), refresh. Editing from the browser lands with 1e.
 */
import { marked } from "marked";
import {
  accountFromPhrase,
  certifyDevice,
  type PrincipalIdentity,
} from "../account.js";
import {
  randomSignKeypair,
  randomBoxKeypair,
  signKeypairFromSeed,
  boxKeypairFromSeed,
  openBox,
  decryptPayload,
  toHex,
  fromHex,
  utf8,
} from "../crypto.js";
import { RelayClient } from "../relay/client.js";

interface DocPayload {
  v: 1;
  path: string;
  content: string;
  mtimeMs: number;
}

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

let identity: PrincipalIdentity | null = null;
let spaceKey: Uint8Array | null = null;
let spaceId: string | null = null;
let notes = new Map<string, DocPayload>();
let cursor = 0;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Reuse (or enroll) this browser as a device for the given account. */
function browserIdentity(phrase: string): PrincipalIdentity {
  const account = accountFromPhrase(phrase);
  const stored = localStorage.getItem("vn-device");
  if (stored) {
    const d = JSON.parse(stored) as { account: string; signPriv: string; boxPriv: string; device: PrincipalIdentity["file"]["device"] };
    if (d.account === toHex(account.sign.pub)) {
      return {
        file: { accountSignPub: d.account, accountEncPub: toHex(account.box.pub), device: d.device },
        deviceSign: signKeypairFromSeed(fromHex(d.signPriv)),
        deviceBox: boxKeypairFromSeed(fromHex(d.boxPriv)),
      };
    }
    localStorage.removeItem("vn-device"); // different account — start clean
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
  const account = accountFromPhrase(phrase); // throws with a friendly message on bad phrase
  identity = browserIdentity(phrase);
  const client = new RelayClient("", identity);
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
}

async function refresh(): Promise<void> {
  if (!identity || !spaceKey || !spaceId) return;
  const client = new RelayClient("", identity);
  const updates = await client.pullUpdates(spaceId, cursor);
  for (const u of updates) {
    cursor = Math.max(cursor, u.seq);
    try {
      const payload = JSON.parse(
        new TextDecoder().decode(decryptPayload(spaceKey, u.blob, `vortex-doc-v1:${u.doc}`))
      ) as DocPayload;
      notes.set(payload.path, payload);
    } catch {
      // update for a doc we can't decrypt/parse — skip, never crash the reader
    }
  }
  renderList();
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/, "");
}

function renderList(filter = ""): void {
  const items = [...notes.values()]
    .filter((n) => !filter || n.path.toLowerCase().includes(filter) || n.content.toLowerCase().includes(filter))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  $("#list").innerHTML =
    items.map((n) => `<a href="#" data-path="${esc(n.path)}">${esc(n.path)}</a>`).join("") ||
    '<div class="empty">Nothing here yet.</div>';
}

function openNote(path: string): void {
  const n = notes.get(path);
  if (!n) return;
  const body = stripFrontmatter(n.content);
  $("#note").innerHTML =
    `<div class="notehead"><span class="path">${esc(n.path)}</span></div>` +
    `<article>${marked.parse(body, { async: false }) as string}</article>`;
  document.querySelectorAll("#list a").forEach((a) => a.classList.toggle("active", (a as HTMLElement).dataset.path === path));
}

// ---- wire up ----
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
  const a = (e.target as HTMLElement).closest("a") as HTMLElement | null;
  if (!a) return;
  e.preventDefault();
  openNote(a.dataset.path ?? "");
});
$("#refreshBtn").addEventListener("click", () => void refresh().catch((e) => alert((e as Error).message)));
$("#filter").addEventListener("input", (e) => renderList((e.target as HTMLInputElement).value.trim().toLowerCase()));
$("#lockBtn").addEventListener("click", () => location.reload());

// theme
const root = document.documentElement;
const saved = localStorage.getItem("vn-theme");
root.setAttribute("data-theme", saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
$("#themeBtn").addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("vn-theme", next);
});
