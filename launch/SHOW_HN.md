# Show HN draft

**Title options** (HN convention: plain, no hype):

1. Show HN: Vortex Notes – Markdown vault with built-in MCP and local semantic search
2. Show HN: A notes vault your agents can actually use (MCP + local embeddings)
3. Show HN: Vortex Notes – shared markdown memory for you and your AI agents

## Post body

I kept seeing the same duct tape everywhere: people pointing OpenClaw or Claude
Code at an Obsidian vault through community REST plugins, self-signed certs, and
keyword-only search — or maintaining a folder of MEMORY.md files by hand.

So I built the thing in the middle: a plain markdown vault with a first-party
MCP server and zero-config local semantic search.

- Your notes are just .md files in a folder. Open them in Obsidian, grep them,
  git them. The index (SQLite) is a disposable cache next to them.
- `vortex-notes mcp` exposes task-shaped tools over stdio: search_notes,
  read_note, surgical edit_note, append_daily, recent_activity, build_context
  (top notes + one hop of wikilinks/backlinks in one call), and remember.
- `remember(fact, supersedes)` gives facts a lifecycle in plain markdown:
  dated bullets with stable ^ids; superseding a fact strikes the old line
  through and points to the new one. Your agent's beliefs stay auditable —
  you can read what it knows and see what it used to believe.
- Search is hybrid BM25 + multilingual embeddings (FTS5 + sqlite-vec +
  multilingual-e5-small via transformers.js), fully on-device. No API key.
  Works across ~100 languages — an English query finds your Spanish notes.
- `--read-only` flag if you want an agent that can search and read but never
  write.

No accounts, no server, no plugins, MIT. npm install -g vortex-notes.

Where this is going: end-to-end encrypted multi-device sync where agents are
first-class cryptographic principals — you share a notebook with an agent the
way you'd share it with a person (sealed per-space keys), every agent write is
signed and attributable, and there's a one-click "undo everything agent X did."
The local CLI stays free and open source.

Happy to answer questions on the search quality tradeoffs (RRF keyword-leg
pollution was the interesting bug) or the E2EE + agents design.

## Launch checklist
- [x] GitHub repo created (vortex-303/vortex-notes, PRIVATE — flip to public at launch, set topics: mcp, agent-memory, notes, e2ee, markdown)
- [x] OpenClaw skill written (launch/openclaw-skill/vortex-notes/SKILL.md, verified against docs.openclaw.ai AgentSkills format) — submit to their skills registry at launch
- [x] npm publish — LIVE 2026-07-13: vortex-notes@0.1.0 (npmjs.com/package/vortex-notes, account: mailstorm)
- [ ] Demo GIF in README (asciinema → agg: init → claude mcp add → agent writes a note → search in Spanish) — NEEDS USER or screen-record session
- [ ] Flip repo public + submit HN Tue–Thu ~14:00 UTC; be online for the first 2h of comments
- [ ] Post to r/ClaudeAI, OpenClaw Discord, MCP directories (mcp.directory, mcpservers.org) after HN
- [ ] Update README before launch: mention E2EE sync + web app now exist (free self-host relay + vortex-relay.fly.dev is ours, not public infra)
