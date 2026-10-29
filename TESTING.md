# Vortex Notes field test

A hands-on pass over every way people use Vortex Notes: browser, phone, chat apps, agents, files.
Run it before a release, or after anything touches sync, pairing or connectors. About an hour.

## Before you start
- Use a **new test account** for all of this, not your real one. A private/incognito window on the laptop keeps it apart from your real session.
- Write the test account's 12 words **on paper**. Never paste them into a chat, an agent, or this page.
- Mark each step ✓ or ✗ as you go. Tap **Copy report** at the bottom and paste it to Claude: failures come with your notes attached.

## Browser on the laptop
_Private window · ~10 min_

1. [ ] Open https://vortex-notes.pages.dev/app → **New here? Create an account** → pick a display name → **Create my notes**.
   **Expect:** 12 words appear. Write them on paper, then continue to an empty notes list.
2. [ ] Tap **+** (New note). Title: `Test`. Body:
   ```
   Launch code is 4417
   
   ## Shopping
   - [ ] milk
   - **bold** and *italic*
   ```
   **Expect:** Formatting appears as you type (heading, checkbox, bold). The note shows in the list.
3. [ ] Open the note's **⋯** menu. Then user menu (bottom left) → **Markdown tips**.
   **Expect:** ⋯ shows Rename / move, Duplicate, History, Copy content, Download .md/.txt, Password-protect, Make public. Markdown tips opens a cheatsheet.
4. [ ] Make a second note `Diary`, then **⋯ → Password-protect**. Set a password. Reload the page.
   **Expect:** Diary shows **This note is password-protected.** **Unlock** with the password opens it unchanged.
5. [ ] On Diary: **Lost the password? Recover an earlier version** (or ⋯ → History).
   **Expect:** History lists versions with author and size. The version before the lock is readable and can be restored.
6. [ ] On `Test`: **⋯ → Make public** → pick a theme (Manuscript / Typewriter / Vortex) → **Publish** → **Copy**. Open the link in another browser.
   **Expect:** The public page shows the note in that theme, with no login.
7. [ ] Edit `Test` (add a line), wait a few seconds, refresh the public page.
   **Expect:** The public page shows the new line (auto-republish). Then **⋯ → Public link… → Unpublish**: the link stops working.
8. [ ] User menu (bottom left) → **Sign out**. Then **I already have a phrase** → type the 12 words from paper.
   **Expect:** You're back in with both notes. A plain reload (without signing out) never asks for the words.

## Phone
_Safari or Chrome · ~8 min_

1. [ ] Open https://vortex-notes.pages.dev/app → **I already have a phrase** → type the 12 words.
   **Expect:** Same two notes as the laptop.
2. [ ] Share → **Add to Home Screen**. Open it from the home-screen icon.
   **Expect:** It opens full screen like an app, with the Vortex Notes icon.
3. [ ] Keep the laptop open on `Test`. On the phone, edit `Test` and add `edited on phone`.
   **Expect:** The laptop shows the change within about 2 seconds, with no refresh.
4. [ ] Now the other way: edit on the laptop.
   **Expect:** The phone updates within about 2 seconds.
5. [ ] Turn on airplane mode. Close and reopen the home-screen app.
   **Expect:** The app still opens and shows your notes. Turn airplane mode off afterwards.
6. [ ] On the phone: user menu → **Agents & devices**.
   **Expect:** It lists this phone and the laptop as devices.

## Chat apps (Claude, ChatGPT)
_Laptop + phone · ~12 min_

1. [ ] In the app: user menu → **Agents & devices** → **Connect a chat app** → name `Claude.ai`, **Read + write** → **Create connector** → **Copy URL**.
   **Expect:** A URL like `https://vortex-notes.pages.dev/mcp/…` (64 characters after /mcp/).
2. [ ] claude.ai → Settings → Connectors → **Add** → custom connector → name `Vortex Notes`, paste the URL. Authentication: keep **No sign-in** (marked Detected), no headers → **Add**.
   **Expect:** A yellow warning about anyone with the URL is expected: the URL is the key. The connector is then listed.
3. [ ] New Claude chat, connector turned on in the tools menu. Ask:
   ```
   Using Vortex Notes, what's the launch code in my Test note?
   ```
   **Expect:** Claude answers **4417**.
4. [ ] Ask Claude:
   ```
   Remember that my test bike is blue.
   ```
   **Expect:** In the web app, `memory/facts.md` now has the fact. ⋯ → History shows it written by **Claude.ai**.
5. [ ] Claude **mobile app**: new chat, same question about the launch code.
   **Expect:** 4417, without adding the connector again.
6. [ ] Create a second connector named `ChatGPT`, **Read-only**. In ChatGPT: Settings → Apps & Connectors → Advanced settings → **Developer mode** on → back → **Create** → paste the URL, authentication **No authentication**.
   **Expect:** ChatGPT lists Vortex Notes and its tools. If it says it couldn't discover OAuth settings, that's expected: pick No authentication.
7. [ ] In ChatGPT (+ → Developer mode → Vortex Notes on), ask for the launch code, then ask it to remember something.
   **Expect:** It reads **4417**. The write is **refused**, because this connector is read-only.
8. [ ] In **Agents & devices**, **Revoke** the ChatGPT connector. Ask ChatGPT for the launch code again.
   **Expect:** The call fails: the URL is dead.

## Agents on the Mac
_Terminal · ~12 min_

> Pairing points Claude Code, Hermes and OpenCode at the TEST account. The wrap-up section moves them back to your real account.

1. [ ] In a terminal:
   ```
   npx -y vortex-notes@latest pair --name mac-test
   ```
   **Expect:** It shows a 6-letter code and waits.
2. [ ] On the **phone**: user menu → **Agents & devices** → **Pair an agent** → type the code → **Look up** → **Read + write** → **Approve**.
   **Expect:** The terminal says **Paired as mac-test**, lists what it wired (Claude Code, Hermes, OpenCode), and syncs.
3. [ ] Restart Claude Code, type `/mcp`, then ask:
   ```
   search my notes for the launch code
   ```
   **Expect:** `/mcp` shows vortex-notes connected. Claude Code answers 4417.
4. [ ] In Claude Code:
   ```
   append to my daily note: tested from Claude Code
   ```
   **Expect:** On the phone, today's daily note has the entry within a few seconds, by **mac-test**.
5. [ ] OpenCode: restart it and ask the same launch-code question.
   **Expect:** 4417.
6. [ ] Hermes: type `/reload-mcp`, then ask for the launch code.
   **Expect:** 4417.
7. [ ] Shell, no MCP:
   ```
   vortex-notes search launch
   vortex-notes remember "Test fact from the shell"
   vortex-notes recent --json
   ```
   **Expect:** Search finds Test.md. The fact appears on the phone in `memory/facts.md`.

## Your notes as files
_Terminal + any editor · ~5 min_

1. [ ] Use a separate folder so your old ~/VortexNotes isn't touched:
   ```
   vortex-notes setup --vault ~/VortexNotes-test
   ```
   **Expect:** It asks for the 12 words, then syncs. The folder holds Test.md, Diary.md and memory/.
2. [ ] Open `~/VortexNotes-test/Test.md` in any editor, add a line, save, then:
   ```
   vortex-notes sync --vault ~/VortexNotes-test
   ```
   **Expect:** The phone shows the new line.
3. [ ] Open the folder as a vault in Obsidian (optional).
   **Expect:** Plain markdown notes and links work there.
4. [ ] Check that Diary.md on disk is unreadable without its password, then:
   ```
   vortex-notes unlock Diary.md --vault ~/VortexNotes-test
   ```
   **Expect:** The file is an encrypted envelope; unlock prints the content after you type the password.

## Permissions and revoking
_Phone + terminal · ~6 min_

1. [ ] Pair a second agent with read-only access:
   ```
   npx -y vortex-notes@latest pair --name ro-test
   ```
   **Expect:** Approve it with **Read-only (search & read, never write)**. Agents & devices shows it as **read-only**.
2. [ ] Try a write through it. Its vault path is in the pair output:
   ```
   VORTEX_NOTES_VAULT=<path pair printed> vortex-notes daily "should fail"
   ```
   **Expect:** The entry never reaches the phone: the server refuses writes from a read-only agent. Note what the command prints.
3. [ ] **Revoke** ro-test in Agents & devices, then sync it:
   ```
   vortex-notes sync --vault <same path>
   ```
   **Expect:** Sync fails. The agent is cut off.
4. [ ] User menu → **Account & recovery** → **Change my 12 words**. Write the new words on paper.
   **Expect:** Notes still open. The old words no longer sign in on a fresh window; the new ones do.
5. [ ] After the change, ask Claude.ai and Claude Code for the launch code again.
   **Expect:** Both still answer 4417 (the page says agents keep working).

## Wrap-up
_~5 min_

1. [ ] **Revoke** the Claude.ai connector and remove it from claude.ai (Settings → Connectors).
   **Expect:** Gone from Agents & devices.
2. [ ] Point the Mac's agents back at your **real** account: in your normal (non-private) browser, run pair and approve with the real account.
   ```
   npx -y vortex-notes@latest pair --name macbook
   ```
   **Expect:** Claude Code, Hermes and OpenCode are re-wired to the real account. This also replaces the fragile ~/.hermes node path from the first pairing.
3. [ ] Revoke `mac-test` in the test account. Delete `~/VortexNotes-test` if you like.
   **Expect:** The test account has no agents left.
4. [ ] Admin stats (real account): tag the test account **test**.
   **Expect:** It's excluded from your real numbers.
