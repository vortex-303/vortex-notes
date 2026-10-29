---
name: vortex-notes
description: Use the user's Vortex Notes as long-term memory. Use when the user says "note this", "remember that…", "what do my notes say about…", asks about their projects, plans or past decisions, wants something logged in their daily note, or starts work on a topic they may have written about before.
---

# Vortex Notes

The user's notes are plain markdown, end-to-end encrypted and shared between them and their AI tools. The Vortex Notes connector gives you these tools: `search_notes`, `build_context`, `read_note`, `list_notes`, `recent_activity`, `write_note`, `edit_note`, `append_daily`, `remember`.

If the tools aren't available, ask the user to connect Vortex Notes from this plugin's Connectors tab and approve the sign-in.

## Find before you answer

- When the user asks about something they may have written down, call `search_notes` first. Queries can be natural language, and a query in one language finds notes in another.
- When starting work on a topic, call `build_context` once instead of several searches: it returns the top notes in full plus the notes they link to.
- Use `read_note` for one full note, `recent_activity` for "what changed lately".
- Cite the note path when you use something from a note.

## Write carefully

- Durable facts ("remember that my bike is blue", preferences, decisions): `remember`. Search for an existing fact first; if the new one replaces it, pass `supersedes` with the old fact's `^id` or a distinctive phrase. The old fact stays visible, struck through. Never delete history.
- Observations, progress and things that happened today: `append_daily`, one bullet.
- A new document: `write_note`. It refuses to overwrite; use `edit_note` (`append`, `prepend` or exact `find_replace`) to change an existing note. Never rewrite a whole note unless asked.
- If a write is refused because the connection is read-only, tell the user; don't retry.

## Conventions

- `[[Wikilinks]]` point to other notes by title; follow them for context.
- Password-protected notes show only a title; their content can't be read here.
- Don't put secrets, such as recovery phrases or passwords, into notes, and never ask for the user's 12 words.
