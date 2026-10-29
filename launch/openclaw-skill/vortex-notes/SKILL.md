---
name: vortex-notes
description: Read, search, and write the user's Vortex Notes vault — plain-markdown notes with local semantic search, daily notes, and durable facts with supersession. Use for "note this down", "remember that…", "what do my notes say about…", and daily journaling.
metadata:
  {
    "openclaw":
      {
        "requires": { "bins": ["vortex-notes"] },
        "install":
          [{ "id": "npm", "kind": "npm", "package": "vortex-notes", "bins": ["vortex-notes"] }],
      },
  }
---

# Vortex Notes

The user's knowledge base is a folder of plain markdown ("the vault"), end-to-end
encrypted and synced to their other devices. Work with it through the
`vortex-notes` commands below — they are the same tools the MCP server exposes,
they apply the vault's conventions for you, and they sync before reading and
after writing. Add `--json` to any command for structured output.

Setup (once per machine): `npm install -g vortex-notes@latest`, then
`vortex-notes pair` — the user approves a code in their app. After that every command finds the paired vault by itself. Otherwise
pass `--vault <dir>` (or set `$VORTEX_NOTES_VAULT`).

## Find things — always start here

```
vortex-notes search "<query>"           # hybrid keyword + multilingual semantic
vortex-notes context "<topic>"          # top notes in full + linked notes, one call
vortex-notes read <path>                # one note, full markdown
vortex-notes recent --days 7            # what changed lately
vortex-notes list [folder]              # note paths
```

Natural-language queries work ("that idea about pricing"), and a query in one
language finds notes in another. Prefer `context` when starting work on a topic.

## Write

```
vortex-notes daily "<entry>"                         # observations, decisions, what happened
vortex-notes remember "<fact>" [--topic <t>]         # durable facts ("remember that X")
vortex-notes remember "<new fact>" --supersedes <^id or distinctive text>
vortex-notes write "<Title>" "<markdown>" [--folder f] [--tags a,b]
vortex-notes edit <path> --append "<text>"           # or --prepend, or --find "<old>" --replace "<new>"
```

- Search for an existing fact before `remember`; if the new fact replaces it,
  pass `--supersedes` — the old fact stays visible, struck through. Never delete
  history.
- Edit surgically (`edit --append`, `--find/--replace`); never rewrite a whole
  note unless asked. `write` refuses to overwrite an existing note.
- Long content: pass `-` and pipe it on stdin (`… | vortex-notes write "Title" -`).
- Commands exit 1 on error; with `--json` the error is `{"error": "…"}` on stdout.

## Notes on the vault

Notes have YAML frontmatter (`title`, `tags`, `created`, `updated`).
`[[Wikilinks]]` reference other notes by title or filename — follow them for
context. Password-protected notes show only their title; their content is
encrypted and can't be read here.

## MCP alternative

If this agent supports MCP, `vortex-notes mcp` (stdio) exposes the same tools
(`search_notes`, `read_note`, `write_note`, `edit_note`, `append_daily`,
`remember`, `build_context`, `recent_activity`, `list_notes`); `npx vortex-notes
pair` wires it into Claude Code, Hermes and OpenCode automatically.
