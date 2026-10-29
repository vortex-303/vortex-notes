# Vortex Notes — Status

## ▶ Resume here (handoff 2026-10-28)
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
User must `npm publish` 0.1.9 (then `npm i -g vortex-notes@latest` — npx prefers the global).

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
