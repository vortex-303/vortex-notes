/** The landing/docs page served at the relay root ("/"). Static, self-contained. */
export function landingShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F8FAF8">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121715">
<title>Vortex Notes — your notes, your agents' memory, one encrypted place</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cg stroke='%2314735C' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12'/%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12' transform='rotate(120 12 12)'/%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12' transform='rotate(240 12 12)'/%3E%3C/g%3E%3Ccircle cx='12' cy='12' r='2.2' fill='%2314735C'/%3E%3C/svg%3E">
<style>
  :root {
    --ground:#F8FAF8; --surface:#FFFFFF; --ink:#1D2421; --ink-soft:#4A554F; --ink-faint:#75817A;
    --line:#DFE6E1; --accent:#14735C; --accent-soft:#E3F0EB; --code-bg:#0E1513; --code-ink:#C9E5DB;
    --mono:ui-monospace,"SF Mono",Menlo,monospace;
    --serif:"Charter","Iowan Old Style",Georgia,serif;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ground:#121715; --surface:#1A211E; --ink:#E6ECE8; --ink-soft:#ACB8B1; --ink-faint:#7D8A83;
      --line:#2C3531; --accent:#4CC2A0; --accent-soft:#1C2F29; --code-bg:#0E1513; --code-ink:#C9E5DB; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--ink); font:17px/1.62 var(--sans); }
  .page { max-width:44rem; margin:0 auto; padding:3.5rem 1.4rem 6rem; }

  .mark { color:var(--accent); display:inline-flex; vertical-align:-4px; }
  .mark svg { width:26px; height:26px; }
  .mark .outer, .mark .inner { transform-origin:12px 12px; }
  .mark .outer { animation:vspin 14s linear infinite; }
  .mark .inner { animation:vspin-rev 9s linear infinite; }
  @keyframes vspin { to { transform:rotate(360deg); } }
  @keyframes vspin-rev { to { transform:rotate(-360deg); } }
  @media (prefers-reduced-motion: reduce) { .mark .outer,.mark .inner { animation:none; } }

  h1 { font:700 2rem/1.2 var(--serif); letter-spacing:-0.015em; margin:0.8rem 0 0.6rem; }
  .tagline { color:var(--ink-soft); font-size:1.05rem; max-width:36rem; margin:0 0 1.6rem; }
  .cta { display:inline-block; background:var(--accent); color:#fff; text-decoration:none;
    border-radius:9px; padding:0.65rem 1.3rem; font:600 0.9rem var(--sans); margin-right:0.8rem; }
  @media (prefers-color-scheme: dark) { .cta { color:#10211C; } }
  .cta.ghost { background:none; color:var(--accent); border:1px solid var(--accent); }

  .promise { margin:2.2rem 0; padding:1rem 1.2rem; background:var(--accent-soft);
    border-left:3px solid var(--accent); font-size:0.95rem; border-radius:0 8px 8px 0; }

  h2 { font:700 1.25rem var(--serif); margin:3rem 0 0.4rem; padding-top:1.6rem; border-top:1px solid var(--line); }
  h2 .k { font:600 0.62rem var(--mono); letter-spacing:0.14em; text-transform:uppercase;
    color:var(--accent); display:block; margin-bottom:0.5rem; }
  p { max-width:40rem; }
  .note { font-size:0.85rem; color:var(--ink-faint); }
  pre { background:var(--code-bg); color:var(--code-ink); border-radius:10px; padding:1rem 1.2rem;
    overflow-x:auto; font:0.8rem/1.7 var(--mono); }
  pre .c { color:#6E8A80; }
  code { font:0.85em var(--mono); background:var(--surface); border:1px solid var(--line);
    border-radius:4px; padding:0.08em 0.35em; }
  ul { max-width:40rem; padding-left:1.3rem; } li { margin-bottom:0.4rem; }
  a { color:var(--accent); }
  footer { margin-top:4rem; padding-top:1.5rem; border-top:1px solid var(--line);
    font-size:0.8rem; color:var(--ink-faint); }
</style>
</head>
<body>
<div class="page">
  <div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <g class="outer" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12"/>
      <path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12" transform="rotate(120 12 12)"/>
      <path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12" transform="rotate(240 12 12)"/>
    </g>
    <g class="inner" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5">
      <path d="M12 6.75 A5.25 5.25 0 0 1 17.25 12"/>
      <path d="M12 6.75 A5.25 5.25 0 0 1 17.25 12" transform="rotate(120 12 12)"/>
      <path d="M12 6.75 A5.25 5.25 0 0 1 17.25 12" transform="rotate(240 12 12)"/>
    </g>
    <circle cx="12" cy="12" r="1.6" fill="currentColor"/>
  </svg></div>

  <h1>Your notes. Your agents' memory.<br>One encrypted place.</h1>
  <p class="tagline">Vortex Notes is a plain-markdown knowledge base that you and your AI agents
  share — with end-to-end encrypted sync, local semantic search, and live-preview editing on
  every device. Agents get scoped, revocable, cryptographically attributed access.</p>

  <a class="cta" href="/app">Open the app</a>
  <a class="cta ghost" href="https://www.npmjs.com/package/vortex-notes">npm install -g vortex-notes</a>

  <div class="promise">This server stores <strong>ciphertext only</strong>. Your 12-word recovery
  phrase is your whole identity — keys are derived in your browser or on your devices, never here.
  There is no password reset, because there is nothing here to reset.</div>

  <h2><span class="k">For you · in the browser</span>Start in 30 seconds</h2>
  <ul>
    <li>Open <a href="/app">the app</a> → <em>Create an account</em> → write down your 12 words.</li>
    <li>Type. Formatting appears as you write (headings, bold, lists, [[links]] — the ⋯ menu has a cheatsheet).</li>
    <li>On your phone: same URL → Share → <em>Add to Home Screen</em>.</li>
  </ul>

  <h2><span class="k">For you · on your computer</span>The vault is a folder of markdown</h2>
<pre>npm install -g vortex-notes
vortex-notes identity login          <span class="c"># your 12 words, once per machine</span>
vortex-notes init                    <span class="c"># creates ~/VortexNotes</span>
vortex-notes sync join --relay https://vortex-relay.fly.dev
vortex-notes sync                    <span class="c"># notes appear as .md files</span>
vortex-notes search "that idea"      <span class="c"># hybrid semantic search, fully local</span></pre>
  <p class="note">Open the folder in Obsidian, grep it, git it — the files are the truth.
  Started on the CLI instead? <code>identity init</code> + <code>sync link</code> creates the account and space from here.</p>

  <h2><span class="k">For Claude Code</span>Give Claude your notes</h2>
<pre>claude mcp add vortex-notes -- vortex-notes mcp --vault ~/VortexNotes</pre>
  <p>Then just talk: <em>“remember that the relay moved to GRU”</em>, <em>“what do my notes say
  about pricing?”</em>, <em>“add to my daily note that I shipped the deploy”.</em>
  Tools include <code>search_notes</code>, <code>remember</code> (facts with supersession),
  <code>build_context</code>, <code>append_daily</code>. Add <code>--read-only</code> for a
  search-only connection.</p>

  <h2><span class="k">For Hermes · OpenClaw · any agent, anywhere</span>Agents are principals, not passengers</h2>
  <p>An agent gets <strong>its own key</strong>, certified by yours, scoped to the spaces you
  grant — enforceable by this relay, attributable on every edit, revocable in one command.</p>
<pre><span class="c"># 1 · On YOUR machine — grant access, get a one-time token:</span>
vortex-notes agent create hermes --space personal \\
  --relay https://vortex-relay.fly.dev        <span class="c"># add --read-only for search-only</span>

<span class="c"># 2 · On the AGENT's machine — ONE command. It bootstraps itself on
#     first run (identity, vault, first sync) and serves MCP, auto-syncing:</span>
vortex-notes agent mcp 'vnat1_…'

<span class="c"># …or as a line in any MCP config:</span>
{ "command": "vortex-notes", "args": ["agent", "mcp", "vnat1_…"] }</pre>
  <p class="note">Skills that teach the conventions to
  <a href="https://github.com/vortex-303/vortex-notes">OpenClaw and Hermes</a> ship in the repo.
  Revoke anytime: <code>vortex-notes agent revoke hermes --relay …</code></p>

  <h2><span class="k">Self-host</span>Don't trust us — run your own relay</h2>
<pre>vortex-notes relay --port 7300 --db ~/relay.db</pre>
  <p class="note">That's the entire server. It serves this page, the app, and an append-only
  log of encrypted blobs it cannot read. MIT licensed.</p>

  <footer>Vortex Notes · MIT ·
    <a href="https://github.com/vortex-303/vortex-notes">GitHub</a> ·
    <a href="https://www.npmjs.com/package/vortex-notes">npm</a> ·
    zero plaintext on this server, by design</footer>
</div>
</body>
</html>`;
}
