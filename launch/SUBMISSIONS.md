# Submission pack — ready-to-paste copy per channel

Legend: **[me]** Claude can execute (PR/file) · **[you]** needs your account/click · **[form]** web form, needs you

One-liner (reuse everywhere):
> **Vortex Notes** — End-to-end-encrypted markdown notes that double as memory for your AI agents. Hybrid on-device semantic search (no API key), MCP server, and scoped/revocable agent keys. `npx vortex-notes pair` to connect any agent; self-hostable relay stores ciphertext only.

Category to file under, in order of fit: **Knowledge & Memory** → Note-taking → Security/E2EE.

---

## A. MCP server directories

### 1. punkpeye/awesome-mcp-servers — PR #10313 OPEN [tracking]
Already submitted. Nudge if stale after ~2 weeks.

### 2. wong2/awesome-mcp-servers [me — PR]
Line for the list (Markdown), under a knowledge/notes section:
> - [vortex-303/vortex-notes](https://github.com/vortex-303/vortex-notes) — E2E-encrypted markdown notes + agent memory; hybrid local semantic search (no API key), scoped/revocable agent keys, self-hostable relay.

### 3. appcypher/awesome-mcp-servers [me — PR]
Same line, matched to their category headers (Knowledge & Memory / Note Taking).

### 4. modelcontextprotocol/servers → Community Servers [me — PR, if it fits their bar]
Alphabetical entry:
> **[Vortex Notes](https://github.com/vortex-303/vortex-notes)** - E2E-encrypted markdown knowledge base with on-device semantic search and scoped, revocable agent access.

### 5. Glama (glama.ai/mcp/servers) [form/auto]
Glama auto-indexes public GitHub MCP servers. Ensure the repo README has an MCP section + `mcp`/`agent-memory` topics (done). Optionally claim the listing with the Glama GitHub app.

### 6. PulseMCP (pulsemcp.com/submit) [form — you]
Name: Vortex Notes · Repo URL · Category: Knowledge & Memory · Blurb: the one-liner above.

### 7. mcp.so / mcpservers.org [form or PR — you/me]
mcpservers.org takes GitHub PRs (add to their servers data). mcp.so has a submit form.

### 8. Smithery (smithery.ai) [you]
Connect the GitHub repo. Note: ours is a stdio server that pairs with a local vault, so list it as reference/local, not a hosted deploy.

---

## B. Awesome-lists (non-MCP)

### 9. awesome-selfhosted [you — deferred]
Requires ~4-month project age + a demo. Resubmit ~November. Entry (Note-taking):
> - Vortex Notes - E2E-encrypted markdown notes with self-hostable relay (stores ciphertext only), on-device search, and MCP agent access. `([Demo](https://vortex-notes.pages.dev))` `MIT` `Nodejs`

### 10. awesome-privacy / awesome-mcp / PKM lists [me — PRs, one at a time]
Use the one-liner, filed under encrypted-notes / knowledge.

---

## C. Reddit — ONE per 48h, watch and reply. Angle-matched titles. [you]

### r/LocalLLaMA — lead with the local-search stack (their love language)
**Title:** I gave my local agents persistent memory as plain markdown + on-device embeddings (no API calls)
**Body:**
> I wanted my agents to remember things across sessions without shipping my notes to anyone. So the memory is a plain-markdown vault with hybrid search built in — BM25 + multilingual-e5 via sqlite-vec + transformers.js, all on-device, ~100 languages, no API key. Agents reach it through an MCP server (search_notes, edit_note, `remember` with supersession so old beliefs get struck through, not overwritten). Sync is end-to-end encrypted and the relay is self-hostable (ciphertext only). Each agent gets its own scoped, revocable key — never sees your recovery phrase. MIT, TypeScript. Repo + hosted demo in comments. Feedback on the memory model welcome.

### r/ClaudeAI — lead with Claude Code memory
**Title:** Gave Claude Code persistent memory: an encrypted markdown vault it shares with me, over MCP
**Body:**
> Claude Code + a notes vault it can actually use: `remember`/`build_context`/surgical `edit_note` over MCP, facts that supersede instead of silently overwriting, on-device semantic search (no API key). It's also my own encrypted notes app (web + installable phone app, instant sync) — same vault, one place. Claude gets its own scoped key via a pairing code I approve on my phone; revoke anytime; every edit is signed as the agent. `npx vortex-notes pair`. Repo in comments.

### r/selfhosted — lead with the ciphertext-only relay
**Title:** Self-hosted E2EE notes where the server stores only ciphertext — and one command runs the relay
**Body:**
> The relay has no plaintext field in its schema — accounts are public keys, notes are sealed blobs. A 12-word phrase is your whole account; keys derive in the browser. `vortex-notes relay` self-hosts it; per-account quotas built in. Bonus for the AI crowd: agents can be given scoped, revocable keys to read/write via MCP without ever seeing your phrase. MIT, Node. Repo + demo in comments.

### r/ObsidianMD — companion, NEVER competitor
**Title:** Built an E2EE sync + agent-access companion that keeps your vault as plain markdown
**Body:**
> Not an Obsidian replacement — your notes stay plain .md. It adds two things I wanted: end-to-end-encrypted sync the server can't read, and a safe way to let an AI agent read/write specific folders (its own key, scoped, revocable, every edit signed as the agent) instead of pointing a REST plugin at your whole vault. Self-hostable, MIT. Curious whether this fits anyone's workflow.

### r/PKMS, r/privacy — later, tailored from the above.

---

## D. X / Twitter build-in-public thread [you]
Hook (attach a 20s screen-record: `pair` → phone approve → agent reads a note; or 2-device instant sync):
> Your notes and your AI agents' memory should be the same encrypted place. So I built it.
>
> • agents get their own scoped, revocable key (MCP)
> • the server stores ciphertext only
> • installable app, sub-second sync, on-device search
>
> solo, MIT, in a few weeks 🧵
Follow-ups: the empty quadrant (agent-native × E2EE) · the account→device→agent cert chain · "change my 12 words" account rotation · public-note themes · self-host in one command. End with repo link.

---

## E. Product Hunt [you + me for assets]
- Tagline: **Your notes. Your agents' memory. One encrypted place.**
- First comment: the "duct tape" origin story from SHOW_HN.md, condensed.
- Gallery: landing hero · installed-app screenshot · pairing-code flow · the 3 public-note themes · admin/instant-sync moment.

---

## Cadence rule
One channel at a time; watch 48h; answer everything; then the next. Directory/awesome PRs (section A/B) are evergreen — those can go out as a small batch. Human posts (C/D/E) are one-at-a-time. Cross-posting everything day one wastes each community's single first impression.
