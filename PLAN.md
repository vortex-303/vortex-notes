# Vortex Notes — Plan

Product: the notes app that is your agents' memory. E2E-encrypted, Obsidian-compatible,
agents as first-class citizens. Full strategy (market research, quadrant analysis,
architecture options): see the strategy artifact linked in STATUS.md.

**Thesis:** nobody owns the "agent-first-class + E2EE" quadrant. Markdown won the
agent-memory debate (OpenClaw, Claude Code, Letta MemFS). Wedge: "the vault your
agents can actually use." Positioning: simplicity — ~10 built-in audited
capabilities, **no plugin system, ever**; no server-side AI ("we never meter your
intelligence", BYO keys).

## Phases

### Phase 0 — OSS daemon/CLI (CURRENT)
MIT `vortex-notes` npm package. Markdown vault + stdio MCP server + local hybrid
search (FTS5 + sqlite-vec + multilingual-e5-small via transformers.js). No sync,
no accounts, no UI. Launch: Show HN + OpenClaw skill + MCP directories.
Success signal: stars/installs/"finally" comments.

- [x] Vault: plain md + frontmatter (ulid id, title, created/updated, tags), daily notes
- [x] Indexer: chunking (~1200 chars, heading context), FTS5, sqlite-vec, mtime-based resync, watcher
- [x] Hybrid search: BM25 + vector, RRF fusion, max 2 chunks/note
- [x] MCP tools: search_notes, read_note, write_note, edit_note (surgical), append_daily, recent_activity, list_notes; read-only mode; MCP annotations (readOnly/destructive hints)
- [x] Tests: core (node:test) + MCP e2e over stdio + web server e2e
- [x] Local web viewer (`serve`, 127.0.0.1:7303): rendered markdown, wikilinks, search, dark/light, SSE live reload, source toggle. Read-only — editing arrives with Phase 1's editor.
- [x] `build_context(topic)` tool — top notes in full + one hop of [[wikilinks]] incl. backlinks
- [x] `remember(fact, supersedes)` tool — fact lifecycle as markdown (dated bullets, ^ids, strikethrough supersession)
- [ ] Polish for launch: npm publish, GitHub repo (vortex-303/vortex-notes), OpenClaw skill, demo GIF

### Phase 1 — E2EE sync + web app (~6–8 wks) — IN PROGRESS
Slices, each shippable:
- [x] **1a. Identity** (2026-07-11): BIP39 12-word phrase → HKDF → account Ed25519+X25519;
  random device keypairs certified by account key; phrase shown once, never stored;
  device secrets 0600 in ~/.vortex-notes; spaces with sealed keys (device + account
  + grantable to any principal — the Phase 2 agent-grant mechanism already works);
  XChaCha20-Poly1305 payloads with AAD doc binding; CLI `identity init/login/show`,
  `space create/list` with hidden phrase input. noble/scure stack (audited, MIT).
- [x] **1b. Relay** (2026-07-11): HTTP ciphertext store (better-sqlite3, no plaintext
  fields), ed25519 signed requests, device registry via account-signed certs,
  per-space append-only update log with seq cursor. Self-host: `vortex-notes relay`.
  Still TODO: WebSocket/SSE push (poll-only now), Fly.io deploy, quotas.
- [x] **1c. Vault↔space sync** (2026-07-11): `sync link/join/status` + `sync`;
  whole-file LWW payloads encrypted per space, AAD-bound to path; phrase needed
  once on join (unseal from account seal, re-seal to device); conflicts preserved
  as .conflict files. TODO polish: auto-sync in serve/mcp daemons, deletions,
  renames, skip-Welcome-on-join.
- [x] **1d. Web app unlock** (2026-07-12): relay serves /app — phrase unlock fully
  client-side (esbuild bundle of scure/noble + marked, 113KB), browser enrolls as a
  certified device (keys in localStorage), unseals space key, decrypts notes in-tab.
  Read-only v0; TODO: edit+push from browser, service worker/PWA manifest, IndexedDB
  instead of localStorage, space picker (uses first space).
- [ ] **1e. Editor**: TipTap (MIT core) + CodeMirror source toggle; per-note Yjs
  docs stored encrypted (decision point: plain-blob LWW first, CRDT after)
Yjs canonical (Y.Doc per note), daemon materializes the md vault as projection;
secsync-pattern encrypted relay (dumb ciphertext store, Fly.io); libsodium key
hierarchy: mnemonic → account Ed25519/X25519 → per-space keys sealed to member
pubkeys (Ente pattern). Web PWA: TipTap (MIT core) + CodeMirror 6 source-mode
toggle on the same Y.Doc. Dark/bright themes, premium typography. Start charging
~$6/mo (free = local-only + self-host relay).
Harvest from persona-cloud: relay server shape, Ed25519 identity + mnemonic wallet
model, X25519+AES-GCM session crypto, CAS chunking — copy code only where trivially
portable; this repo stays standalone.

### Phase 2 — Agents as principals (~4 wks, category-defining launch)
Agent keypairs; per-space sealed grants ("share a notebook with your agent like a
person"); signed attribution per block + margin tint for agent writes; per-agent
undo; memory inbox ("your agents learned 6 things this week — keep/edit/discard").

### Phase 3 — Reach
Hosted OAuth MCP endpoint for cloud agents; mobile capture PWA (text/voice/photo →
agent files it); file/PDF knowledge drops via CAS into the same search; native
mobile if capture demand proves out.

## Non-goals (permanent or v1)
Plugins (permanent). Server-side AI/embeddings (impossible under E2EE — the
constraint is the brand). Real-time multi-user collab at v1 (crypto supports it
later). TEEs, SSO. LATAM-first GTM — this product is global/dev-first.
