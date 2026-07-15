# Show HN draft

**Title options** (HN convention: plain, no hype):

1. Show HN: Vortex Notes – Markdown vault with built-in MCP and local semantic search
2. Show HN: A notes vault your agents can actually use (MCP + local embeddings)
3. Show HN: Vortex Notes – shared markdown memory for you and your AI agents

## Post body

I kept seeing the same duct tape: people pointing OpenClaw, Hermes, or Claude
Code at an Obsidian vault through community REST plugins and keyword-only search
— or hand-maintaining a folder of MEMORY.md files. So I built the thing in the
middle: one plain-markdown knowledge base that you and your agents share.

The pitch is "your notes AND your agents' memory, one encrypted place":

- **Files are the truth.** Your notes are .md files in a folder — Obsidian-
  compatible, greppable, git-able. A first-party MCP server (`vortex-notes mcp`)
  exposes task-shaped tools: search_notes, surgical edit_note, append_daily,
  build_context, and remember (facts with supersession — the old line gets
  struck through and points to the new one, so an agent's beliefs stay
  auditable, never silently overwritten).
- **Search is on-device.** Hybrid BM25 + multilingual embeddings (FTS5 +
  sqlite-vec + a small local model). No API key, works across ~100 languages —
  an English query finds your Spanish notes.
- **E2E-encrypted sync.** A 12-word phrase is your whole account; the relay
  stores ciphertext only (self-host it with one command, or use the hosted one).
  The web app derives keys in-tab — sign up, write, edit on your phone with
  Obsidian-style live-preview markdown. No password, no reset, because there's
  nothing on the server to reset.
- **Agents are principals, not passengers.** `npx vortex-notes pair` on an
  agent's machine shows a 6-letter code; you approve it from the app (read-only
  optional). The agent gets its OWN key — generated on its machine, never
  transmitted, certified by yours, scoped to the spaces you grant, relay-
  enforced. Every edit it makes is signed as the agent, and revoke is one
  command. No competitor combines "agents can fully use it" with "the server
  can't read it" — that quadrant was empty.

Stack: TypeScript, all-MIT (noble/scure crypto, CodeMirror, better-sqlite3,
transformers.js). ~35 tests. Relay is a small Node service on Fly.

npm install -g vortex-notes · https://github.com/vortex-303/vortex-notes

Happy to dig into the design: how agents get scoped access without ever seeing
your phrase (account -> device -> agent certificate chain), why I chose 3-way
merge over a CRDT for now, or the RRF keyword-leg pollution bug in search.

## Launch checklist
- [x] GitHub repo created (vortex-303/vortex-notes, PRIVATE — flip to public at launch, set topics: mcp, agent-memory, notes, e2ee, markdown)
- [x] OpenClaw skill written (launch/openclaw-skill/vortex-notes/SKILL.md, verified against docs.openclaw.ai AgentSkills format) — submit to their skills registry at launch
- [x] npm publish — LIVE 2026-07-13: vortex-notes@0.1.0 (npmjs.com/package/vortex-notes, account: mailstorm)
- [ ] Demo GIF in README (asciinema → agg: init → claude mcp add → agent writes a note → search in Spanish) — NEEDS USER or screen-record session
- [ ] Flip repo public + submit HN Tue–Thu ~14:00 UTC; be online for the first 2h of comments
- [ ] Post to r/ClaudeAI, OpenClaw Discord, MCP directories (mcp.directory, mcpservers.org) after HN
- [ ] Update README before launch: mention E2EE sync + web app now exist (free self-host relay + vortex-relay.fly.dev is ours, not public infra)
