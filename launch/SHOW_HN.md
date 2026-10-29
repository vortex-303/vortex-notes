# Show HN draft (v2 — refreshed 2026-08-03)

**Title** (HN convention: plain, specific, no hype). Best pick first:

1. **Show HN: E2E-encrypted notes that double as memory for your AI agents**
2. Show HN: Vortex Notes – shared encrypted memory for you and your AI agents
3. Show HN: Notes app where agents get their own scoped, revocable key (MCP + E2EE)

Post between Tue–Thu ~14:00 UTC. Link the **repo**, not the landing (HN prefers source). Stay online 2h for comments.

## Post body

Every setup I saw for "give my AI agent memory" was duct tape: point Claude/Cursor/
Hermes at an Obsidian vault through a community REST plugin, or hand-maintain a pile
of MEMORY.md files, with keyword-only search and your whole filesystem exposed. So I
built the thing in the middle — one place that is *both* your encrypted notes app and
your agents' shared memory.

Two claims most notes apps can't make at once:

- **The server can't read anything.** A 12-word phrase is your whole account; keys are
  derived in your browser tab. The relay stores ciphertext only — there's no plaintext
  field in its schema, and no password to reset because there's nothing on the server
  to reset. Self-host the relay with one command, or use the hosted one.

- **Agents are principals, not passengers.** `npx vortex-notes pair` on an agent's
  machine shows a 6-letter code; you approve it from the app. The agent gets its OWN
  keypair — generated on its machine, never transmitted, certified by yours, scoped to
  the spaces you grant, read-only optional, relay-enforced. Every edit it makes is
  signed as the agent, and revoke is one command. That quadrant — "agents can fully use
  it" AND "the server can't read it" — was empty.

The rest, briefly:

- **Files are the truth.** Plain .md, Obsidian-compatible, greppable. A first-party MCP
  server exposes task-shaped tools: search_notes, surgical edit_note, append_daily,
  build_context, and `remember` (facts with supersession — an agent's old belief gets
  struck through and points to the new one, so its memory stays auditable).
- **On-device search.** Hybrid BM25 + multilingual embeddings (FTS5 + sqlite-vec + a
  small local model). No API key; an English query finds your Spanish notes.
- **It's a real app now.** Installable PWA (iPhone/Android/Mac home screen, works
  offline), sub-second cross-device sync over WebSocket, Obsidian-style live-preview
  markdown editor on mobile, per-note password locks (unlockable by password *or* your
  12 words), full version history, one-tap public notes with themed pages.

Stack: TypeScript, all-MIT (noble/scure crypto, CodeMirror, better-sqlite3,
transformers.js). ~90 tests incl. a browser suite. Relay is a small Node service on Fly.

Repo: https://github.com/vortex-303/vortex-notes · try it: https://vortex-notes.pages.dev

Happy to go deep on the design: the account→device→agent certificate chain (how an
agent gets scoped access without ever seeing your phrase), why I shipped 3-way merge
instead of a CRDT, account rotation ("change my 12 words" without losing data), or how
the WebSocket sync stays a content-free doorbell so the E2EE model is untouched.

## Comment ammo (have these ready)
- "Why not Obsidian + a sync plugin?" → scoped/revocable/**attributed** agent access +
  E2EE sync the server can't read + install-as-app + web/phone, all first-party.
- "How do agents get access without your phrase?" → account key certifies a device key
  certifies an agent key; the agent key is born on the agent's machine. Relay checks the
  chain + scope on every request.
- "3-way merge vs CRDT?" → diff3 against a base copy ≈ CRDT quality at 30s-class sync
  without the double-bootstrap hazard; the new WebSocket channel makes it feel instant.
- "What can a malicious relay do?" → serve stale/withheld ciphertext (detectable via
  seq gaps); it can never read, forge (sigs), or silently alter a note.
- The RRF keyword-leg pollution bug in search (stopwords + document-frequency filter).

## Do NOT
- Don't repost if it doesn't catch — one shot per URL. Don't ask for upvotes.
- Don't link the landing page as the primary link; HN wants the repo.

## Status / checklist
- [x] Repo public: github.com/vortex-303/vortex-notes (topics: mcp, agent-memory, notes, e2ee, markdown)
- [x] npm: vortex-notes (account: mailstorm) — bump to current before HN so installs match the post
- [x] Live app + hosted relay: vortex-notes.pages.dev (self-host free; hosted is ours, not public infra)
- [ ] 20–30s demo (screen-record: `npx vortex-notes pair` → approve on phone → agent reads/writes a note; or the 2-device instant-sync moment)
- [ ] Round 1 got flagged (item 48945862, acct vortex11) — use a fresh, aged account and the "Show HN:" prefix; email hn@ycombinator.com for the second-chance pool if it stalls
