# Vortex Notes

**Markdown notes with a first-party MCP server and zero-config local semantic search.**
The vault your agents can actually use.

Your notes are plain `.md` files in a folder — open them in any editor, grep them,
git them, point Obsidian at them. What Vortex Notes adds:

- **First-party MCP server** — Claude Code, OpenClaw, Cursor, or any MCP client can
  search, read, and write your notes through task-shaped tools (`search_notes`,
  `read_note`, `write_note`, `edit_note`, `append_daily`, `recent_activity`,
  `build_context`, `remember`), not a CRUD API mirror. Works headless: no app
  needs to be open.
- **Facts with a lifecycle** — `remember(fact, supersedes)` records dated facts in
  `memory/*.md`; superseded facts stay visible with strikethrough and a pointer to
  what replaced them. Your agent's beliefs are auditable markdown, not a black box.
- **One-call context** — `build_context(topic)` returns the top notes in full plus
  one hop of `[[wikilinks]]` (including backlinks), so agents start a task with
  the right context instead of five search round-trips.
- **Local hybrid semantic search** — BM25 + multilingual embeddings (SQLite FTS5 +
  sqlite-vec + a small on-device model). No API key, no cloud, nothing leaves your
  machine. Works in English, Spanish, and ~100 other languages.
- **Daily notes as agent memory** — agents append timestamped entries to
  `daily/YYYY-MM-DD.md`; you read them like a journal.
- **Read-only mode** — connect an agent with `--read-only` and it can search and
  read but never write.
- **Local web viewer** — `vortex-notes serve` opens your vault at
  `http://127.0.0.1:7303`: crisp typographic rendering, dark/light themes,
  clickable `[[wikilinks]]`, hybrid search, a source-view toggle, and live
  reload when you or an agent edits a note.

No accounts. No sync (yet — E2E-encrypted sync is what we're building next).
No plugins. MIT.

## Install

```sh
npm install -g vortex-notes
vortex-notes init                      # creates ~/VortexNotes
```

## Connect an agent

Claude Code:

```sh
claude mcp add vortex-notes -- vortex-notes mcp --vault ~/VortexNotes
```

Any other MCP client (stdio):

```json
{
  "command": "vortex-notes",
  "args": ["mcp", "--vault", "/path/to/vault"]
}
```

Add `--read-only` to make the vault read-only for that client.

## Use it yourself

```sh
vortex-notes serve                              # web viewer at 127.0.0.1:7303
vortex-notes search "that idea about pricing"   # hybrid semantic + keyword
vortex-notes index                              # rebuild the index manually
```

The index lives in `.vortex/index.db` inside the vault and is disposable — the
markdown files are always the source of truth. Set `VORTEX_NOTES_NO_SEMANTIC=1`
to skip embeddings entirely (keyword search only, no model download).

## Why

Agent memory converged on folders of markdown. Notes apps converged on bolted-on,
app-must-be-running integrations. Vortex Notes starts from the middle: one vault
that is both your notes and your agents' memory, with search that actually works
and files you can walk away with at any moment.

## Roadmap

- End-to-end encrypted multi-device sync (the server stores ciphertext only)
- A premium web editor over the same vault
- Agents as first-class principals: per-space grants, signed attribution,
  per-agent undo, and a "what your agents learned this week" review queue

MIT © Vortex303
