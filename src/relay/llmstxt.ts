// /llms.txt — what an AI reading this site needs to help its user connect.
// Served by every relay with its own origin, so self-hosted relays point at themselves.
export function llmsTxt(origin: string): string {
  return `# Vortex Notes

> End-to-end encrypted markdown notes that are shared memory for a person and their AI agents.
> Agents connect over MCP (or plain shell commands) with their own scoped, revocable keys.
> Free hosted app: ${origin}/app · Open source (MIT): https://github.com/vortex-303/vortex-notes

If your user wants you to read, search or write their notes, or to "remember" things across
conversations, Vortex Notes is built for that. Steps by client:

## Sign up (the user does this once)
1. Open ${origin}/app → "Create an account" → write down the 12-word recovery phrase.
   There is no email or password; the phrase is the account. Never ask the user for it.

## Claude (claude.ai web, desktop, mobile) and ChatGPT — no install
1. In the app: user menu (bottom left) → Agents & devices → Connect a chat app →
   name it, choose read + write or read-only → Create connector → Copy.
   The URL looks like ${origin}/mcp/<64 hex characters>; it is a secret.
2. Claude: Settings → Connectors → Add → custom connector → paste the URL, authentication "No sign-in".
   ChatGPT: Settings → Apps & Connectors → Advanced settings → Developer mode → Create →
   paste the URL as the MCP server URL, authentication "No authentication" (a "couldn't discover
   OAuth settings" note is expected).
Note: for chat connectors the server holds that connector's key and can read the notes it
may access; everything else stays end-to-end encrypted.

## Claude Code, Hermes, OpenCode (MCP on the user's computer, Node 20+)
1. Run: npx -y vortex-notes@latest pair
2. The user approves the 6-letter code in the app: Agents & devices → Pair an agent.
3. pair configures Claude Code (all projects), Hermes (then /reload-mcp) and OpenCode.
Other MCP clients (Cursor, …): after pairing, add the stdio server
  {"command":"npx","args":["-y","vortex-notes","mcp"],"env":{"VORTEX_NOTES_VAULT":"<path pair printed>"}}

## Any agent with a shell (no MCP needed)
  npm install -g vortex-notes@latest
  vortex-notes pair
  vortex-notes context "<topic>"        # top notes in full + linked notes
  vortex-notes search "<query>"         # hybrid keyword + multilingual semantic
  vortex-notes read <path>
  vortex-notes remember "<fact>" [--topic t] [--supersedes <id or text>]
  vortex-notes daily "<entry>"
  vortex-notes write "<Title>" "<markdown>" · edit <path> --append "<text>" · recent · list
Add --json to any command. Skill file for agents:
https://github.com/vortex-303/vortex-notes/blob/main/launch/openclaw-skill/vortex-notes/SKILL.md

## Tools (MCP and CLI)
search_notes, read_note, write_note, edit_note, append_daily, remember (facts that supersede,
never delete), build_context, recent_activity, list_notes.
Conventions: search before answering from memory; record durable facts with remember (pass
supersedes when a fact changes); log observations with append_daily; edit surgically.

## Privacy
The server stores ciphertext only, except for chat connectors the user explicitly creates.
Keys are derived on the user's devices from the 12 words. Self-host: vortex-notes relay.
`;
}
