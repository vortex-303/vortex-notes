# Vortex Notes — Status

## ▶ Native iPhone + Mac apps, and the Mac download (handoff 2026-10-29, other session)
**Read this before touching `ios/`, the landing page or `scripts/build-cf.mjs`.** None of the `ios/` work is
committed yet (it shows as untracked); commit it separately from web work. Plans:
- `~/.claude/plans/review-vortex-notes-thw-curious-sprout.md` (latest: the editor and the DMG)
- `ios/PUBLISHING.md` (App Store)
- `ios/README.md` (how to build and test)

**Live now (deployed 2026-10-29 by this session):**
- **Mac direct download:** https://vortex-notes.pages.dev/download/VortexNotes.dmg (+ `.sha256`).
  - Developer ID signed, sandboxed, notarized and stapled. Gatekeeper accepts the downloaded copy (checked with a
    quarantine flag set).
  - Landing hero has a "Download for Mac" button (`.macdl`, hidden on phones) and a "macOS 14+ · free · beta ·
    notarized" line. No App Store badge, by the user's choice.
  - Build changes: `scripts/build-cf.mjs` copies the git-ignored `site-downloads/` → `/download/` and excludes it
    from the worker; `deploy/cf/edge.ts` lists both files in `STATIC_PATHS`.
  - To re-release:
    `VORTEX_NOTARY_PROFILE=vortex-notary ios/scripts/mac-dmg.sh`, copy `ios/build/release/VortexNotes.dmg` into
    `site-downloads/`, regenerate `VortexNotes.dmg.sha256` there, then `npm run cf:deploy`.
  - The `vortex-notary` notarytool profile is in this Mac's Keychain.
  - The DMG doesn't update itself yet (no Sparkle); people re-download.
- That deploy also published `5bb8cba` (the web rich-editor fix) and the relay doc-id fix below.

**Apple setup:**
- Paid team **K8YT3BZZAT** (Nicolas Ruggieri). Development, Distribution and Developer ID certificates are on this
  Mac.
- Bundle id **`dev.vortex303.notes`** for both iPhone and Mac, so there's one App Store listing.
- Store name "Vortex Notes"; home-screen name "Vortex".
- iPhone only (no iPad), free, UTC daily notes for now.
- The user's iPhone 16 is paired; the app is installed (Debug build).
- MacKit's ids (`com.soulzeek.mackit.store`) are unrelated; leave them alone.

**Code layout (`ios/`):**
- **`VortexKit`** (Swift package, no dependencies; `swift test`, live tests need `VORTEX_LIVE=1`):
  - crypto, BIP39, certs, request signing, relay client, `/ws` live sync
  - SQLite `NoteStore` (local writes are the outbox)
  - `SyncEngine`: the CLI's rules, plus a node-diff3 port, plus paging past 500
  - `MarkdownSyntax` and `MarkdownEditing` for the editor
  - 29 tests
- **Interop with the TypeScript code is tested both ways:**
  - `scripts/gen-interop-vectors.ts` → `test/vectors/interop.json`
  - then `test/interop-verify.ts`
  - plus 408 diff3 cases that must match `tryDiff3`
  - **If you change `crypto.ts`, `account.ts`, `notelock.ts` or the sync payloads, rerun these.**
- **App** (XcodeGen `ios/project.yml`; `xcodegen` generates the project, which isn't committed):
  - `App/Shared`, `App/iOS` (tabs: Notes, Capture, Search, Settings), `App/macOS` (three-column window +
    menu-bar capture)
  - UI tests in `App/UITests`
  - `test/ios-peer.ts` drives the CLI as "the other device" for live tests

**What the apps do:**
- Sign in with the 12 words, or create an account (the 12 words are shown once, and the user picks daily-note or
  note-per-capture).
- Notes list sorted by modified/created date, up to 6 pins (per device), keyword search, settings.
- **Editor = native live markdown (TextKit 2):** the text view holds the raw markdown byte for byte. Markers are
  hidden by attributes; round checkboxes and bullets are drawn in the margin.
  - Links, bare URLs and wikilinks open on tap, with no caret or keyboard.
  - Notes-style Return/Backspace; an Aa bar (same format list as the web).
  - ⋯ → Edit markdown (per note).
  - An untouched note is never written, and an edit changes only the edited lines.
  - Remote changes to an open note are taken in; unsaved typing is saved first so diff3 merges it.
  - All of this is verified by XCUITest against a local relay with the CLI as the peer.

**For the web rich editor (`richedit.ts`), from this session's review:**
1. **Whole-note re-serialization on the first edit.** Tiptap normalizes every block (bullet chars, emphasis, table
   padding), and `renderedShape` lets that through. It makes noisy diffs, and diff3 conflicts when an agent edits
   the same note. **Fix:** keep the original `raw` text for unchanged top-level blocks.
2. **Remote edits to an open note are overwritten** on the next save.
3. **"Edit markdown" becomes the global default** after one toggle; it should be per note.

**Fixed in shared code:**
- The relay rejected doc ids containing `!'()*~` (encodeURIComponent leaves those bare). One regex in `core.ts`;
  now deployed.

**Known and not fixed:**
- The CLI's `syncVault` sets cursor = max(pushed seq), which can skip another device's update that lands in between.
  Swift doesn't do this.
- macOS file names can be NFD; Swift matches by NFC for lookups.
- Web pull doesn't page past 500.

**Next (needs the user's go-ahead):**
1. **Account deletion:** relay `DELETE /v1/account`, plus web and apps. **App Store blocker.**
2. Commit `ios/` + the site changes.
3. iPhone capture surfaces: share sheet, Siri/Shortcuts/Action Button, widgets, Control Center. Needs an App Group.
4. TestFlight, privacy manifest, real icon (`ios/PUBLISHING.md`).
5. On-device semantic search.
6. Still unanswered: what the user meant by "duo".

## ▶ Web, OAuth and directories (handoff 2026-10-29 evening, web session)
**State at 2026-10-29 ~21:00:**
- Web: everything committed and pushed (latest `738ed85`, funnel icons).
- Deployed to prod at ~21:00 with Claude's `npm run cf:deploy`. That works when the user explicitly says "deploy"; otherwise the user runs it in their own Terminal (no `!`, no trailing dot).
- Live and verified:
  - `/favicon.ico` (funnel)
  - SW cache v3
  - Mac DMG `a486d14d…` with New Note at `/download/VortexNotes.dmg`
  - rich editor (e2e-richedit 31/31 on prod)
- DO code goes live about 1 minute after a deploy.
- **Uncommitted on purpose:**
  - `ios/` (all native app work: the other session's code, plus my icon and New Note changes)
  - `src/relay/landing.ts`, `deploy/cf/edge.ts`, `scripts/build-cf.mjs`, which mix in the other session's Download-for-Mac changes
  - `STATUS.md`
  - All deployed from the working tree. Commit these together when the user okays committing `ios/`.
- Native apps:
  - The iPhone 16 has the latest Debug build. Reinstall with `xcodebuild … -destination id=00008140-000E1D843682801C`, then `xcrun devicectl device install app --device F992B777-DD75-5478-B4A0-26313695AEF4 <app>`.
  - Mac DMG: `VORTEX_NOTARY_PROFILE=vortex-notary /Users/n/vortex-notes/ios/scripts/mac-dmg.sh` (use absolute paths), copy it to `site-downloads/`, then `shasum`, then deploy.

**Icons (2026-10-29 late):** the funnel (B) is now everywhere. Run `node design/icons/brand.mjs` to regenerate it all:
- `ios/` AppIcon (full-bleed iOS PNG without alpha, plus the Mac grid sizes), and `Logo` + `MenuBarLogo` template imagesets.
  `OnboardingView` and the Mac `MenuBarExtra` now use these instead of the SF Symbol `tornado`.
  These `ios/` edits are uncommitted, like the rest of `ios/`.
- The iPhone has the new build installed.
- Superseded by the New Note DMG below (live).
- Web: favicon, `/favicon.ico`, in-page mark, PWA icons and ChatGPT assets (`738ed85`). The SW cache bumped to v3.
- `src/relay/landing.ts` is changed too but uncommitted, because it also holds the other session's Download-for-Mac changes.

**New Note in the native apps (2026-10-29 late, uncommitted in `ios/`):**
- A pencil button in the Notes list, plus **File → New Note ⌘N** on the Mac.
- A blank note opens with the caret ready. The file name is a timestamp (`note-YYYY-MM-DD-HH-MM.md`) and the title follows the first line.
  It's quoted in YAML when needed. Code: `AppModel.newNote`, `saveBody`, `retitled`.
- An empty new note is deleted when you leave it, before it ever syncs.
- The iPhone Capture tab icon is now `tray.and.arrow.down`.
- Test: `App/UITests/NewNoteUITests.swift` passes, and the CLI peer received exactly one note titled "Shopping list".
- Gotcha: reset the simulator first (`simctl uninstall` + `simctl keychain reset`), because a leftover session ignores `VORTEX_TEST_PHRASE`.
- Installed on the iPhone. The notarized DMG `a486d14d…` is live at `/download/VortexNotes.dmg`.

**Self-host (2026-10-29, `26c5045` + `b6d454b`, deployed):**
- `vortex-notes relay` now reads `RELAY_CONNECTOR_KEK`, `RELAY_QUOTA_MB`, `RELAY_ADMIN_ACCOUNT` and `OPENAI_APPS_CHALLENGE` (via `relayOptionsFromEnv`).
  The DB defaults to `~/.vortex-notes/relay.db` (`--db :memory:` for tests).
- The landing page and legal pages show the serving origin. On a self-host the privacy and terms pages say they're the hosted service's template.
  The Mac download link is absolute.
- Verified on a self-host:
  - all 13 browser suites
  - verify-clients 18/18 (that script's `pair` lacked `--relay`; fixed)
  - restart persistence, quota, and connector keys `k1:` at rest
- Gaps:
  - The native apps can't point at a self-host (Settings shows the relay read-only). That's for the `ios/` work.
  - The quota message says "or upgrade" even on self-hosts.

**Start a new session here (next steps, in order):**
0. Ask the user whether to **commit `ios/`** (+ the three mixed site files and STATUS.md) now; the other session's notes ask the same.
1. **Claude MCP connector listing** (not submitted yet): claude.ai/directory/manage → Submit new → MCP connector →
   `https://vortex-notes.pages.dev/mcp`. Answers: `launch/directory-submissions.md` / https://claude.ai/artifact/A4eKQ8bWhzoGr2Joj6CNwV.
2. **Claude plugin:** publish is requested and it's waiting for an Anthropic reviewer (claude.ai/directory/manage/plugins/7a31fc8a-3f05-4c15-be23-bf12ce189f03).
   Nothing to do unless the reviewer asks. Optional: "Set up push updates" (GitHub webhook).
3. ~~Favicon / funnel everywhere~~ DONE (web, PWA, ChatGPT assets, iOS/Mac app icons, in-app logo, menu bar).
   Regenerate with `node design/icons/brand.mjs`. Check whether claude.ai now shows the funnel on the connectors (it may cache).
4. **ChatGPT app:** the user verifies their OpenAI org and records a 1–2 minute demo video. Then:
   - put the URL in `plugins/chatgpt/plugin.json`
   - `wrangler secret put OPENAI_APPS_CHALLENGE` with the portal's token, then deploy
   - `scripts/build-chatgpt-plugin.sh`, then upload the ZIP
5. Coordinate with the other session (native apps, `ios/`): it owns `ios/` and its uncommitted `landing.ts` / `edge.ts` / `build-cf.mjs` / `STATUS.md` changes.
   Its open items: account deletion (an App Store blocker; relay `DELETE /v1/account` + web + apps; `/privacy` currently promises deletion on request), iPhone capture surfaces (share sheet, Shortcuts, widgets), TestFlight.
6. Ideas the user raised but didn't schedule: a native rich editor parity check (Mac/iPhone vs web), and the hands-on field test (`TESTING.md`; the artifact checklist).

**Live:**
- **OAuth sign-in on one shared `/mcp` URL** (`src/relay/oauth.ts`). The relay is its own OAuth 2.1 server:
  - DCR, PKCE S256, exact redirect matching, single-use 2-min codes, hashed tokens, rotating refresh tokens.
  - Consent screen in the web app (`/app?oauth=<id>`) creates a connector the same way "Connect a chat app" does.
  - Revoke kills its tokens. Secret-URL connectors still work.
  - Tests: `test/hostedmcp.test.ts` and `test/e2e-oauth.mjs`, which includes the official MCP SDK client.
  - Verified in claude.ai: Claude detected "Sign in now" + "Register automatically".
- **`/privacy` and `/terms`** (`src/relay/legal.ts`). They promise account deletion within 30 days, by request through GitHub issues, until a real delete exists.
- **Tool annotations:** every tool has a title and a readOnly or destructive hint (directory requirement, tested).
- **`/.well-known/openai-apps-challenge`** serves the `OPENAI_APPS_CHALLENGE` env/secret when it's set (for ChatGPT's domain check).
- **Rich editor (Apple-Notes-style), the default on the web** (`src/webapp/richedit.ts`, `editor.ts`; Tiptap pinned 3.31.4):
  - Notes open rendered, with an Aa menu; ⋯ → Edit markdown shows the raw text (per note).
  - Wikilinks, bare URLs and links open on click.
  - An untouched note is never saved, and unchanged blocks keep their exact text.
  - Notes that can't round-trip open as markdown.
  - Remote edits merge into an open note (diff3 via `src/merge.ts`).
  - Test: `test/e2e-richedit.mjs` (31 checks).
- **Landing rewrite:** "Where does your AI live?" picker. Test: `test/e2e-landing.mjs`.

**Directories:**
- **Claude plugin** (`plugins/vortex-notes`, marketplace `.claude-plugin/marketplace.json`, icon = `design/icons` B · Funnel): submitted, scan passed, **in review** (v0.1.0 @ `5bb8cba`). The user should click Publish to request the reviewer, and can optionally set up push updates.
- **Claude MCP connector listing:** NOT submitted yet. Use claude.ai/directory/manage → Submit new → MCP connector → `https://vortex-notes.pages.dev/mcp`.
- Paste-ready answers: `launch/directory-submissions.md` and the artifact https://claude.ai/artifact/A4eKQ8bWhzoGr2Joj6CNwV.
- Reviewer test account: its 12 words are in `~/vortex-reviewer/identity-output.txt` (chmod 600; seeded with Test / Kiln build / Clay notes).
- **ChatGPT app:** package in `plugins/chatgpt/`, built by `scripts/build-chatgpt-plugin.sh` → `dist/vortex-notes-chatgpt.zip`. Needs:
  - OpenAI org verification
  - a demo video URL in its `plugin.json`
  - the domain-check token set as a secret
- Also listed: the official MCP Registry 0.1.11 and Glama (claimed, released).
- npm 0.1.11 published.

**Open:**
- Favicon: connectors show the Cloudflare logo because the site has no `/favicon.ico`. Serve the funnel icon.
- Other surfaces still use the rings icon: web app, PWA, ChatGPT package.
- Throwaway prod test accounts from e2e runs: tag them "test" in Admin stats.
- The leftover forks `vortex-303/awesome-mcp-servers-wong2` and `-appcypher` need deleting in the browser (the token lacks `delete_repo`).
- The user's hands-on checklist: https://claude.ai/artifact/QkWaEKqwGP5pbLbPwGJgGb (also `TESTING.md`).

## Resume here (handoff 2026-10-29, 0.1.11)
Shipped + deployed today (prod https://vortex-notes.pages.dev, `npm run cf:deploy`;
DO code takes ~1 min to go live after deploy):
- Landing rewritten (`src/relay/landing.ts`): hero, 3 benefits, how-it-works, ONE
  "Where does your AI live?" picker (8 chips, one panel each, `#connect-<id>` deep
  links, legacy #agents/#you/#selfhost mapped), Privacy + Self-host door. Phone =
  3 tabs. Test: `node test/e2e-landing.mjs` (SHOTS=<dir> for 390/1280 × light/dark).
- `/.well-known/*` (and `/mcp/<t>/.well-known/*`) now 404, not 401: ChatGPT's
  "Couldn't discover OAuth settings" pushed OAuth; pick "No authentication".
- MCP serverInfo reports the package version (was hard-coded 0.1.0).
- Claude.ai menu verified from the user's screenshot: Settings → Connectors → Add →
  custom connector, auth "No sign-in" (auto-detected).
- `TESTING.md` = 42-step hands-on field test (also a tickable page for the user).
- Glama: Dockerfile build OK, release published, badge "9 tools, maintenance B".
  punkpeye #10313 comment posted (still closed; maintainer to reopen).
Release 0.1.11: bumped in package.json + server.json; the USER runs `npm publish` then
`mcp-publisher publish`. Leftover forks awesome-mcp-servers-wong2/-appcypher: user deletes
(token lacks delete_repo).
Next: (1) user finishes the field test → fix the ✗s; (2) Level 2 OAuth on one `/mcp`
URL (relay as OAuth 2.1 AS with PKCE + DCR, consent screen in the web app creates the
connector like "Connect a chat app"; unlocks Claude directory, ChatGPT apps, registry
remotes); (3) re-pair the Mac to the real account (field-test wrap-up), gpubox Hermes.

## Earlier handoff (2026-10-28)
State: everything live + committed (`f49775d`, main, NOT pushed — repo is public;
push needs `gh auth switch -u vortex-303`). npm 0.1.8 published. Relay =
https://vortex-notes.pages.dev (`npm run cf:deploy`). Fly app destroyed.

User's setup on this Mac:
- New web account; Account ID `3e5b7fb0…13a1` = RELAY_ADMIN_ACCOUNT (admin panel on).
  ⚠ The user pasted a set of 12 words into chat on 2026-10-28 — advised a fresh
  account or Account → "Change my 12 words". If they make a new account, swap the
  new Account ID into deploy/cf/wrangler.toml [vars] and redeploy.
- This Mac paired as agent "macbook": vault `~/.vortex-agents/macbook-188bf3e2/vault`
  (has test-note.md, code 0069). Wired into Claude Code (user scope, ✔ Connected),
  Hermes, OpenCode. Restart Claude Code → use the vortex-notes MCP tools directly.
- Global `vortex-notes` 0.1.8 in ~/.local (npx prefers it over downloading!).
  Install scripts for onnxruntime-node/sharp were skipped → semantic search may
  fail; fix: `npm install -g --allow-scripts=onnxruntime-node,sharp,protobufjs vortex-notes@latest`.
- Old Fly-era state backed up in ~/vortex-old. ~/Documents/main/.vortex was
  recreated (no sync link) — the user's Obsidian vault is NOT in the new account.

Agent CLI (2026-10-29, built, 0.1.9 NOT published): `search read write edit daily
remember context recent list` = the MCP tools as commands (src/agentcli.ts →
src/tools.ts VaultTools, shared with mcp.ts). Pull before / push after write when
linked, --json, --offline, stdin via "-". Implicit default ~/VortexNotes yields to
the sole paired vault (a stale Fly-era ~/VortexNotes exists on this Mac). Empty
VORTEX_NOTES_VAULT = unset. OpenClaw skill rewritten around the commands.
0.1.9 PUBLISHED 2026-10-29. Landing reworked (Connect your AI: chat apps first, then
`npx -y vortex-notes@latest pair` — VERIFIED bare npx runs a stale global, @latest doesn't;
honest 'unless you connect a chat app' promise/footer; phone tabs follow #hash links).
Clean `npm i -g` works despite npm skipping install scripts (onnxruntime ships prebuilt
binaries); first semantic search downloads ~120MB model (minutes), then ~0.8s.
Known: harness entries from npx run `npx -y vortex-notes mcp` (bare) → a stale global would win.

Client verification (2026-10-29): `scripts/verify-clients.sh` (PKG=local|npm, MODELS=1,
RELAY=…) runs install → pair → Claude Code (`claude -p --mcp-config --strict-mcp-config`),
OpenCode (project opencode.json), Hermes (`hermes mcp test` with temp HOME), stdio
config, shell CLI, hosted connector via official MCP Inspector — against PROD with a
throwaway account, real configs checksum-verified unchanged. 22/22 with MODELS=1.
Found + fixed: MCP writes in short sessions never pushed (30s tick) → nudge-on-write +
flush on exit (test/mcpsync.test.ts); hermes-private node → prefer system node.
Cursor CLI not logged in here (config-level verified only). 0.1.10 built, NOT published.
Manual still: real Claude.ai / ChatGPT connector check.

Discovery level 1 (2026-10-29): server.json (validated, io.github.vortex-303/vortex-notes,
npm stdio + `mcp` arg) + package.json mcpName + glama.json + /llms.txt (live, own origin).
appcypher fork entry icon fixed → pages.dev. USER TODO: npm publish 0.1.10 → `mcp-publisher
login github` (as vortex-303) + `mcp-publisher publish` from repo root; push main (glama.json)
→ claim on glama.ai → reopen punkpeye#10313 (closed inactive 2026-09-07); click PR links for
wong2 + appcypher (gh PR creation blocked by permission check). gh active account `soulzeek`
fails login ("suspended") — use vortex-303. Level 2 next: OAuth for /mcp → Claude + ChatGPT directories.

Open items / next:
1. Verify MCP in a fresh Claude Code session (search/remember round-trip to web app).
2. Harness entries launch node from `~/.hermes/node/bin/node` (Hermes's bundled
   node, first on PATH when pair ran) — fragile. Switch to /opt/homebrew/bin/node
   and make wire.ts avoid ~/.hermes/node (offered, not done).
3. Real claude.ai + ChatGPT connector test (only protocol-level stand-in tested).
   Later: OAuth instead of secret URL.
4. Pair gpubox (Hermes there) with `npx -y vortex-notes pair`.
5. Optional: upload ~/Documents/main (Obsidian) into the new account (needs
   phrase flow: `vortex-notes setup` / `sync link`, not pair).
6. "DeepSeek harness" (user's "DSH"): unknown tool, not installed here — use
   connector URL if it takes remote MCP, else pair's "Any MCP" line.
7. Tag the throwaway e2e account in Admin stats as "test".
8. External links still on vortex-relay.fly.dev: awesome-mcp PR icon URLs, HN post.

## Hosted MCP connectors (2026-10-28) — claude.ai / ChatGPT
- Web: Agents & devices → "Connect a chat app": browser makes a cloud-agent keypair,
  certifies + seals the space key (`grantAgent` in webapp, shared with pair approve),
  uploads seeds (sign‖box, 64B) to `POST /v1/connectors` → URL `/mcp/<64-hex token>`.
- Relay (`src/relay/hostedmcp.ts`, wired in core `handleMcp`): stateless Streamable
  HTTP JSON-RPC (initialize/tools/list/tools/call/ping; notifications → 202), same tool
  names as stdio MCP, keyword search only. Decrypted view cached per space by seq.
  Writes go through core `appendUpdate` (quota + WS poke), author = cloud agent.
- Seeds verified to match the agent cert; stored `k1:` under secret
  RELAY_CONNECTOR_KEK (CF secret set; Node env) else `p1:` plain. Revoking the
  principal deletes the connector row → URL 404.
- Note formatting moved to `src/notes.ts` (NoteOps over a read/write backend);
  Vault delegates. CF needs `nodejs_compat` for gray-matter.
- Tests: test/hostedmcp.test.ts, test/e2e-connector.mjs (passes on Node, local CF, prod).
- Next: OAuth instead of secret URL; semantic search on relay (Workers AI) maybe.

## Hosting (2026-10-28): Cloudflare free tier, Fly deleted
- Hosted relay = **https://vortex-notes.pages.dev** (fresh database; all Fly-era
  accounts are gone by choice). Fly app `vortex-relay` + volume destroyed.
- Relay logic is platform-neutral in `src/relay/core.ts` (Fetch Request/Response +
  sync `SqlStore`). Hosts: `src/relay/server.ts` (Node + better-sqlite3 + `ws`:
  self-host, tests) and `deploy/cf/worker.ts` (one SQLite-backed Durable Object
  "main", hibernatable WebSockets for /ws).
- Front door = classic Pages project `vortex-notes` (`deploy/cf/pages`, `_worker.js`
  from `deploy/cf/pages.ts` → DO via `script_name`). DO Worker `vortex-notes-do`
  has `workers_dev = false` — never expose a *.workers.dev URL (account subdomain).
- Deploy: `npm run cf:deploy`. Local CF runtime: `npm run cf:dev` (:8788), then
  `E2E_BASE=http://127.0.0.1:8788 node test/e2e-webapp.mjs` (any e2e suite).
- Admin/quota config lives in `deploy/cf/wrangler.toml` [vars]. Country comes
  from `request.cf.country` (no mmdb on CF; Node self-host still uses it).
- DO SQL gotchas: bind ArrayBuffer not Uint8Array; no lastInsertRowid (core
  uses `INSERT … RETURNING`); migrations probe columns with `SELECT … LIMIT 0`.
- CLI 0.1.8 (unpublished): default relay = pages.dev; new `sync move --relay`
  (switch to a relay that already has the space, keeps cursor; `relink` is for
  an EMPTY relay and re-uploads seals from the local copy).
- `pair` (src/wire.ts) wires EVERY harness found: Hermes (one `--env A B`, no
  dash-flags in --args → npm_config_yes env), Claude Code `--scope user`, OpenCode
  ~/.config/opencode/opencode.json. From npx cache → `npx -y vortex-notes mcp`;
  else stable node (Homebrew Cellar → bin symlink) + script. Pair does a first
  sync. Vault.resolve expands `~` (MCP configs have no shell). Test wiring safely
  with `env -i HOME=<tmp> PATH=/opt/homebrew/bin:/usr/bin:/bin` (no hermes/claude).

**Phase 0 COMPLETE; Phase 1 slice 1a (identity) DONE (2026-07-11).** See PLAN.md for
phases; strategy artifact: https://claude.ai/code/artifact/0b58a836-a787-450f-ac70-84ff821074f4

## Phase 1a: Identity layer (verified live)
- 12-word BIP39 phrase = the account. `identity init` shows it once; same phrase
  on another machine (`identity login`, hidden input) derives the same account
  fingerprint with fresh device keys certified by the account signing key.
- Files: src/crypto.ts (sealed box, XChaCha20-Poly1305+AAD, HKDF, ed25519/x25519),
  src/identity.ts (phrase→keys, device certs, ~/.vortex-notes storage, 0600),
  src/spaces.ts (space keys sealed to device+account, grantSpace = the Phase 2
  agent mechanism, encryptDoc/decryptDoc bound to doc id).
- Deps: @scure/bip39 + @noble/{curves,hashes,ciphers} v2 — subpath imports NEED
  `.js` suffix; hkdf salt/info must be Uint8Array not string.
- VORTEX_NOTES_HOME env overrides ~/.vortex-notes (used by tests).
- 21/21 tests at 1a; 25/25 after 1b+1c.

## Phase 1b+1c: Relay + sync (verified live via CLI)
- Relay: src/relay/server.ts — HTTP ciphertext store, ed25519 signed requests
  (METHOD\npath?query\nts\nsha256(body)), device registry via account-signed
  certs, per-space update log w/ seq. `vortex-notes relay --port --db`.
- Sync: src/sync.ts — `sync link` / `sync join` (phrase once) / `sync` /
  `sync status`. Whole-file LWW, AAD=path, conflicts → .conflict-<ts>.md.
  State in .vortex/sync.json (cursor + per-file hashes).
- Live-verified: two homes, two vaults, self-hosted relay; `grep` of relay.db
  finds no plaintext. Doc ids with slashes must be URL-encoded (relay decodes).
- Known polish: Welcome.md conflicts on join (both vaults auto-create it);
  no deletion/rename sync; no push notify (poll only); no auto-sync daemon.
- Next: 1d web unlock, 1e editor (see PLAN.md), relay deploy to Fly.

## What works (verified, not just typechecked)
- `vortex-notes init/index/search/mcp` CLI
- MCP server over stdio, 9 tools, e2e-tested with the MCP SDK client
  (write → read → surgical edit → search → daily → recent → remember/supersede → build_context)
- `remember(fact, topic?, supersedes?)`: dated bullets with `^f-…` ids in
  memory/*.md; supersession = strikethrough + pointer, never deletion;
  supersede by id or distinctive substring; double-supersede rejected
- `build_context(topic)`: top search hits in full (2.5k cap each) + one hop of
  [[wikilinks]] both directions (links table populated at index time)
- Read-only mode blocks writes (tested)
- Hybrid search: FTS5 BM25 + sqlite-vec (multilingual-e5-small, q8, via
  transformers.js), RRF fusion, max 2 chunks/note
- Cross-lingual verified live: EN query "breaded meat with cheese" → Spanish
  milanesas note ranked #1; pure-semantic "why email cannot be sent from the
  VPS" → SMTP/port-25 note ranked #1 (zero keyword overlap)
- File watcher reindexes on change (chokidar, 400ms debounce)
- **Local web app** (`vortex-notes serve`, default 127.0.0.1:7303): server-
  rendered markdown (marked), resolved [[wikilinks]] as app links, hybrid search
  in sidebar, dark/light themes, source-view toggle, SSE live reload on file
  change, /raw/ asset serving with path-escape guards, nonce CSP (note content
  can't execute scripts). **Editing**: ＋ new note (folder/Title syntax),
  markdown editor (Cmd/Ctrl+S, frontmatter preserved), delete w/ confirm, daily
  quick-capture in sidebar. Textarea for now — TipTap/CRDT editor is Phase 1.
  Endpoints: / (shell), GET/POST/PUT/DELETE /api/note, /api/notes,
  /api/search?q=, POST /api/daily, /api/events (SSE), /raw/<path>. Binds
  127.0.0.1 only; mutations require Content-Type: application/json (CSRF guard:
  cross-origin pages can't preflight). SSE reload never clobbers an open editor.
  User's live vault: their Obsidian vault ~/Documents/main.
- 14/14 tests (`npm test` after `npm run build`; embeddings disabled in tests
  via VORTEX_NOTES_NO_SEMANTIC=1 so CI never downloads the model)
- Schema migrations: index is a disposable cache — version mismatch drops all
  tables and rebuilds from the vault (verified live v1→v2)

## Hard-won details
- **Keyword-leg pollution**: RRF treats any FTS hit as evidence, so stopwords
  ("with", "de") made junk notes outrank true semantic hits. Fix is layered:
  multilingual stopword set (en/es/pt/fr/de) + document-frequency filter
  (drop terms matching >25% of chunks) in `toFtsQuery` (src/search.ts). DF
  alone fails on tiny vaults — df=1 can't distinguish rare from generic.
- E5 models need "query: " / "passage: " prefixes (src/embeddings.ts).
- MCP stdio: NEVER console.log — stdout is the protocol. All logging stderr.
- sqlite-vec KNN needs `AND k = ?` in the WHERE clause; embeddings bound as
  Buffer over the Float32Array; rowid inserted as BigInt.
- `node --test dist/` (bare dir) fails on this Node — use glob
  `node --test "dist-test/test/*.test.js"`.
- Embedding model: first `index`/`mcp` run downloads ~120MB to HF cache
  (~/.cache/huggingface). Vault index at `.vortex/index.db`, disposable.

## Hard-won details (round 2)
- **Titles weren't searchable** — FTS only indexed chunk text; fixed by using the
  note title as heading context for heading-less chunks (also improves embeddings).
- FTS/vec ghost rows: `DELETE FROM fts_chunks` on an external-content table
  doesn't error but may leave ghosts; results stay correct because the chunk
  join filters them. Schema-bump rebuild clears them periodically.
- **chokidar keeps the event loop alive**: any process that starts the vault
  watcher must hold the handle from `startVaultWatcher()` and `close()` it, or
  it never exits (this hung the test runner). `startWebServer` returns
  `close()` which tears down SSE clients, watcher, HTTP server, and DB.

## Next (launch prep, needs user)
1. GitHub repo vortex-303/vortex-notes (private until launch), npm publish
2. OpenClaw skill + demo GIF + Show HN draft
3. Then Phase 1: E2EE sync + web app (see PLAN.md)
