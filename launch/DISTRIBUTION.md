# Distribution kit — ready-to-paste copy per channel

Status legend: [me] = Claude can execute on your word · [you] = needs your account/presence

---

## Week 1 — anchor

### 1. Show HN [you]
- Prereq: `npm publish` 0.1.7 (Terminal), final README pass.
- Post body: `launch/SHOW_HN.md`. Title pick: **"Show HN: Vortex Notes – shared markdown memory for you and your AI agents"**
- Tue–Thu ~14:00 UTC. Stay 2h for comments. Link the repo, not the landing (HN prefers source).
- Comment ammo: RRF keyword-pollution bug story; why diff3 over CRDT; the account→device→agent cert chain; "why not just Obsidian+plugin" (answer: scoped/revocable/attributed agent access + E2EE sync + web/phone).

### 2. MCP directories [me, same day]
- mcpservers.org — PR to their repo with server entry
- PulseMCP, Glama, Smithery, mcp.directory — submission forms/PRs
- Entry blurb (reuse everywhere):
  > **vortex-notes** — Plain-markdown knowledge base with hybrid local semantic search (no API key), daily notes, and facts with supersession. Agents get scoped, revocable access via pairing codes; E2EE multi-device sync included. `npx vortex-notes pair` to connect any agent machine.

### 3. Awesome-list PRs [me, same day]
- awesome-mcp-servers → Note-taking section
- awesome-selfhosted → Note-taking/Knowledge-management ("self-hostable E2E-encrypted relay in one command: `vortex-notes relay`")
- awesome-privacy / awesome-encryption candidates

---

## Week 2 — ecosystems

### 4. Hermes [me: PR; you: Discord]
- PR `launch/hermes-skill/vortex-notes/` → `NousResearch/hermes-agent` `optional-skills/` (mirror qmd's placement).
- Discord post:
  > Built a notes/memory backend for Hermes: plain markdown + local semantic search + E2EE sync. One command to connect: `npx vortex-notes pair` — shows a 6-letter code, you approve from your phone, Hermes gets its own scoped key (read-only optional, revocable, every edit signed as the agent). Skill in the repo. Feedback wanted: https://vortex-relay.fly.dev

### 5. OpenClaw [me: skill submission; you: Discord]
- Submit `launch/openclaw-skill/vortex-notes/` to their skills registry.
- Discord angle: "If you're pointing OpenClaw at an Obsidian vault via REST plugins — this is that, but first-party: semantic search built in, works headless, and the agent gets its own scoped key instead of your whole filesystem."

### 6. Reddit (one/week, angle-matched) [you]
- **r/selfhosted**: "Self-hosted E2EE notes where the server is one command and stores only ciphertext" — lead with `vortex-notes relay`, quotas, no plaintext schema.
- **r/ClaudeAI**: "Gave Claude Code persistent memory: markdown vault + MCP with facts that supersede instead of overwrite" — lead with `remember`/`build_context`.
- **r/LocalLLaMA**: "Agent memory as plain markdown + local embeddings (multilingual-e5, sqlite-vec), no API calls" — lead with the search stack.
- **r/ObsidianMD** (gentle): "I built an E2EE sync + agent-access companion that keeps your vault as plain markdown" — emphasize vault-compatibility, never competition.
- **r/PKMS**, **r/privacy** later with tailored angles.

### 7. Product Hunt [you, +me for assets]
- Tagline: "Your notes. Your agents' memory. One encrypted place."
- Gallery: landing hero, app screenshot, pairing-code flow, the 3 public-note themes.

---

## Week 3 — broadeners

### 8. X/Twitter build-in-public thread [you]
- Hook tweet: screen-record `npx vortex-notes pair` → phone approve → Hermes reading your notes. 20 seconds, no sound needed.
- Thread: the empty quadrant (agent-native × E2EE), the cert chain, public-note themes, "built solo in a week with Claude".

### 9. Technical writeup [me drafts, you publish]
- "How AI agents get scoped access to end-to-end-encrypted notes" — account→device→agent certificate chain, relay-enforced scopes, pairing UX. Targets: HN (second bite), lobste.rs, dev.to.

### 10. AlternativeTo listing [me]
- Position as alternative to: Obsidian Sync, Standard Notes, Notion (partial). Honest feature matrix.

---

## Infrastructure before firing
- [ ] 0.1.7 on npm [you — Terminal publish]
- [ ] Final README pass [me]
- [ ] Privacy-respecting relay analytics (request counts by route, no IPs/UA retention) so we can see which channel moves [me]
- [ ] GitHub Discussions or issues templates for support [me]

## Cadence rule
One channel at a time, watch it for 48h, answer everything, then next. Cross-posting everything on day one wastes the one first-impression each community gives.
