# Vortex Notes for Claude

Gives Claude long-term memory that you own: your Vortex Notes, plain markdown that is end-to-end encrypted and shared with your other AI tools and devices.

## Install

- **claude.ai:** Customize → Plugins → Add → Add marketplace → `vortex-303/vortex-notes`, then install Vortex Notes.
- **Claude Code:**

  ```
  /plugin install vortex-notes --marketplace vortex-303/vortex-notes
  ```

## Use it

1. Install the plugin, then open its **Connectors** tab and connect **Vortex Notes**.
2. Sign in with your Vortex Notes account (or create one at https://vortex-notes.pages.dev/app) and approve access: read + write, or read-only.
3. Ask things like "what do my notes say about the kiln build?", "remember that my test bike is blue", or "add to my daily note: shipped the landing page".

The skill tells Claude to search your notes before answering, record lasting facts with `remember` (a new fact supersedes the old one instead of deleting it), log progress in your daily note, and edit notes surgically.

## Data

The connector talks only to `vortex-notes.pages.dev`. Your notes are end-to-end encrypted; for a chat connection like this one, the server holds that connection's key so it can answer Claude's requests, and it can read the notes you let that connection access. Revoke it any time in the app under Agents & devices. Privacy policy: https://vortex-notes.pages.dev/privacy. The plugin itself stores nothing.

## License

MIT. Source: https://github.com/vortex-303/vortex-notes
