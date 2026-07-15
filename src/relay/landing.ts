/** The landing/docs page served at the relay root ("/"). Static, self-contained. */

const RELAY = "https://vortex-relay.fly.dev";

const MARK = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
</svg>`;

export function landingShell(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F8FAF8">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121715">
<meta name="description" content="Plain-markdown notes you share with your AI agents — end-to-end encrypted sync, local semantic search, scoped agent access.">
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
      --line:#2C3531; --accent:#4CC2A0; --accent-soft:#1C2F29; }
  }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; scroll-padding-top:4rem; }
  body { margin:0; background:var(--ground); color:var(--ink); font:17px/1.62 var(--sans); }
  .page { max-width:46rem; margin:0 auto; padding:0 1.4rem 6rem; }

  nav.top { position:sticky; top:0; z-index:10; background:color-mix(in srgb, var(--ground) 88%, transparent);
    backdrop-filter:blur(10px); border-bottom:1px solid var(--line); }
  nav.top .in { max-width:46rem; margin:0 auto; padding:0.55rem 1.4rem; display:flex; gap:1.1rem; align-items:center; }
  nav.top a { color:var(--ink-soft); text-decoration:none; font:500 0.8rem var(--sans); white-space:nowrap; }
  nav.top a:hover { color:var(--accent); }
  nav.top .navmark { margin-right:auto; display:flex; align-items:center; gap:0.45rem;
    font:600 0.85rem var(--sans); color:var(--ink); }
  nav.top .navmark .vx { color:var(--accent); }

  .mark { color:var(--accent); display:inline-flex; }
  .mark svg { width:22px; height:22px; display:block; }
  .mark .outer, .mark .inner { transform-origin:12px 12px; }
  .mark .outer { animation:vspin 14s linear infinite; }
  .mark .inner { animation:vspin-rev 9s linear infinite; }
  @keyframes vspin { to { transform:rotate(360deg); } }
  @keyframes vspin-rev { to { transform:rotate(-360deg); } }
  @media (prefers-reduced-motion: reduce) { .mark .outer,.mark .inner { animation:none; } }

  header.hero { padding:4.5rem 0 0; }
  header.hero .mark svg { width:34px; height:34px; }
  h1 { font:700 2.35rem/1.15 var(--serif); letter-spacing:-0.02em; margin:1rem 0 0.7rem; text-wrap:balance; }
  .tagline { color:var(--ink-soft); font-size:1.08rem; max-width:38rem; margin:0 0 1.7rem; }
  .cta { display:inline-block; background:var(--accent); color:#fff; text-decoration:none;
    border-radius:10px; padding:0.7rem 1.4rem; font:600 0.92rem var(--sans); margin:0 0.7rem 0.7rem 0; }
  @media (prefers-color-scheme: dark) { .cta { color:#10211C; } }
  .cta.ghost { background:none; color:var(--accent); border:1px solid var(--accent); }

  .promise { margin:2rem 0 0; padding:0.95rem 1.15rem; background:var(--accent-soft);
    border-left:3px solid var(--accent); font-size:0.92rem; border-radius:0 8px 8px 0; color:var(--ink-soft); }
  .promise strong { color:var(--ink); }

  .k { font:600 0.62rem var(--mono); letter-spacing:0.16em; text-transform:uppercase;
    color:var(--accent); display:block; margin:3.4rem 0 0; }
  h2 { font:700 1.45rem var(--serif); letter-spacing:-0.01em; margin:0.3rem 0 0.5rem; }
  h3 { font:650 1.02rem var(--sans); margin:1.9rem 0 0.4rem; }
  p { max-width:41rem; }
  .note { font-size:0.85rem; color:var(--ink-faint); max-width:41rem; }

  .codewrap { position:relative; max-width:41rem; }
  pre { background:var(--code-bg); color:var(--code-ink); border-radius:10px; padding:0.95rem 1.1rem;
    overflow-x:auto; font:0.8rem/1.7 var(--mono); margin:0.6rem 0 1rem; }
  pre .c { color:#6E8A80; }
  .copy { position:absolute; top:1rem; right:0.6rem; background:rgba(255,255,255,0.08);
    color:#9DB8AE; border:none; border-radius:6px; font:0.65rem var(--mono); padding:0.3rem 0.55rem;
    cursor:pointer; }
  .copy:hover { color:#fff; }
  code { font:0.84em var(--mono); background:var(--surface); border:1px solid var(--line);
    border-radius:4px; padding:0.08em 0.35em; }

  .steps { counter-reset:st; list-style:none; padding:0; max-width:41rem; margin:1rem 0 0; }
  .steps li { counter-increment:st; display:grid; grid-template-columns:2rem 1fr; gap:0.7rem;
    padding:0.55rem 0; }
  .steps li::before { content:counter(st); font:600 0.8rem var(--mono); color:var(--accent);
    background:var(--accent-soft); border-radius:50%; width:1.5rem; height:1.5rem;
    display:flex; align-items:center; justify-content:center; margin-top:0.15rem; }

  .agents { display:grid; gap:0.7rem; margin:1.2rem 0; }
  .agent { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:0.95rem 1.15rem; }
  .agent h4 { margin:0 0 0.15rem; font:650 0.95rem var(--sans); }
  .agent h4 span { font:500 0.68rem var(--mono); color:var(--ink-faint); margin-left:0.5rem; }
  .agent p { margin:0 0 0.5rem; font-size:0.85rem; color:var(--ink-soft); }
  .agent pre { margin:0; font-size:0.74rem; }
  .agent .codewrap { max-width:none; }
  .agent .copy { top:0.45rem; }
  .agent a { color:var(--accent); }

  .pairviz { display:flex; align-items:stretch; gap:0.9rem; margin:1.4rem 0; flex-wrap:wrap;
    font:0.8rem/1.45 var(--sans); color:var(--ink-soft); }
  .pairviz .box { background:var(--surface); border:1px solid var(--line); border-radius:10px;
    padding:0.6rem 0.9rem; text-align:center; }
  .pairviz .box b { display:block; font:600 0.78rem var(--sans); color:var(--ink); }
  .pairviz .code { font:700 1rem var(--mono); color:var(--accent); letter-spacing:0.2em; }
  .pairviz .arrow { color:var(--ink-faint); align-self:center; }

  footer { margin-top:4.5rem; padding-top:1.5rem; border-top:1px solid var(--line);
    font-size:0.8rem; color:var(--ink-faint); }
  footer a { color:var(--accent); }
  @media (max-width:600px) {
    h1 { font-size:1.85rem; }
    nav.top .in { gap:0.8rem; overflow-x:auto; }
  }
</style>
</head>
<body>
<nav class="top"><div class="in">
  <span class="navmark"><span class="mark" aria-hidden="true">${MARK}</span><span><span class="vx">Vortex</span> Notes</span></span>
  <a href="#you">For you</a><a href="#agents">For agents</a><a href="#selfhost">Self-host</a><a href="/app">Open app →</a>
</div></nav>
<div class="page">

<header class="hero">
  <span class="mark" aria-hidden="true">${MARK}</span>
  <h1>Your notes. Your agents' memory. One encrypted place.</h1>
  <p class="tagline">Plain-markdown notes that you and your AI agents share — synced end-to-end
  encrypted, searchable semantically on-device, editable everywhere with live-preview markdown.
  Agents get their own keys: scoped, attributed, revocable.</p>
  <a class="cta" href="/app">Open the app</a>
  <a class="cta ghost" href="https://www.npmjs.com/package/vortex-notes">Install the CLI</a>
  <div class="promise"><strong>This server stores ciphertext only.</strong> Your 12-word recovery
  phrase is your whole identity — keys are derived in your browser or on your devices, never here.
  There is no password reset, because there is nothing here to reset.</div>
</header>

<span class="k" id="you">Door 1 · For you</span>
<h2>Start in the browser, own it as files</h2>
<ol class="steps">
  <li><div><a href="/app">Open the app</a> → <em>Create an account</em> → write down your 12 words. Start typing —
    formatting appears as you write, and the ⋯ menu has a markdown cheatsheet.</div></li>
  <li><div>On your phone: same URL → Share → <em>Add to Home Screen</em>. Everything syncs.</div></li>
  <li><div>On your computer, your notes become a plain folder of markdown — Obsidian-compatible, greppable, yours:</div></li>
</ol>
<div class="codewrap"><pre>npm install -g vortex-notes
vortex-notes setup                   <span class="c"># asks your 12 words — that's the whole setup</span>
vortex-notes search "that idea"      <span class="c"># semantic search, fully local, any language</span></pre><button class="copy">copy</button></div>
<p class="note">Your notes appear as a plain folder of markdown (<code>~/VortexNotes</code>) and stay
in sync. Power users: the <code>identity</code>, <code>sync</code>, and <code>space</code> subcommands
do each step individually, including pointing at a self-hosted relay.</p>

<span class="k" id="agents">Door 2 · For your agents</span>
<h2>Agents are principals, not passengers</h2>
<p>An agent gets <strong>its own key</strong> — generated on its machine, never transmitted —
certified by yours, scoped to the spaces you grant, read-only if you say so. Every edit it makes
is signed as the agent. Revoking takes one tap.</p>

<h3>Connect any agent machine — one command, nothing to configure</h3>
<div class="codewrap"><pre>npx vortex-notes pair</pre><button class="copy">copy</button></div>
<div class="pairviz">
  <span class="box"><b>agent machine</b>shows <span class="code">KM3PXR</span></span>
  <span class="arrow">→</span>
  <span class="box"><b>your phone</b>⋯ menu → Pair an agent<br>approve · read-only optional</span>
  <span class="arrow">→</span>
  <span class="box"><b>done</b>agent syncs — scoped &amp; signed</span>
</div>
<p class="note">The code is single-use and expires in 15 minutes. When pairing completes, the
command prints the exact wiring line for your harness:</p>

<div class="agents">
  <div class="agent"><h4>Claude Code <span>MCP</span></h4>
    <p>On your own machine it uses your vault directly — no pairing needed:</p>
    <div class="codewrap"><pre>claude mcp add vortex-notes -- vortex-notes mcp --vault ~/VortexNotes</pre><button class="copy">copy</button></div>
  </div>
  <div class="agent"><h4>Hermes <span>MCP · pairing</span></h4>
    <p>After <code>npx vortex-notes pair</code> on the Hermes machine:</p>
    <div class="codewrap"><pre>hermes mcp add vortex-notes --command vortex-notes --args mcp --vault &lt;printed path&gt;</pre><button class="copy">copy</button></div>
  </div>
  <div class="agent"><h4>OpenClaw <span>skill · files</span></h4>
    <p>OpenClaw is filesystem-native: sync a vault on its machine (pair it, or use your own
    account) and install the <a href="https://github.com/vortex-303/vortex-notes">vortex-notes
    skill</a> so it knows the conventions — daily notes, facts with supersession, search-first.</p>
  </div>
  <div class="agent"><h4>Cursor · Claude Desktop · any MCP client <span>MCP</span></h4>
    <div class="codewrap"><pre>{ "command": "vortex-notes", "args": ["mcp", "--vault", "~/VortexNotes"] }</pre><button class="copy">copy</button></div>
  </div>
  <div class="agent"><h4>Everything else <span>plain files</span></h4>
    <p>The vault is a folder of markdown. Any tool that reads files already works, and
    <code>vortex-notes search</code> gives it local semantic search. Add <code>--read-only</code>
    to any MCP command for search-and-read-only access.</p>
  </div>
</div>
<p class="note">Agent tools: <code>search_notes</code> · <code>read_note</code> · <code>write_note</code> ·
<code>edit_note</code> · <code>append_daily</code> · <code>remember</code> (facts that supersede, never delete) ·
<code>build_context</code> · <code>recent_activity</code>. Revoke any agent:
<code>vortex-notes agent revoke &lt;name&gt;</code>.</p>

<span class="k" id="selfhost">Door 3 · Self-host</span>
<h2>Don't trust us — run your own</h2>
<div class="codewrap"><pre>vortex-notes relay --port 7300 --db ~/relay.db</pre><button class="copy">copy</button></div>
<p class="note">That's the entire server: it serves this page, the app, and an append-only log of
encrypted blobs it cannot read. Point every command above at it with <code>--relay</code>. MIT licensed.</p>

<footer>Vortex Notes · MIT ·
  <a href="https://github.com/vortex-303/vortex-notes">GitHub</a> ·
  <a href="https://www.npmjs.com/package/vortex-notes">npm</a> ·
  zero plaintext on this server, by design</footer>
</div>
<script nonce="${nonce}">
document.querySelectorAll(".copy").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var pre = btn.parentElement.querySelector("pre");
    var text = pre.innerText.split("\\n").map(function (l) { return l.replace(/#[^#]*$/, "").trimEnd(); })
      .filter(function (l) { return l.length; }).join("\\n");
    navigator.clipboard.writeText(text).then(function () {
      btn.textContent = "copied";
      setTimeout(function () { btn.textContent = "copy"; }, 1500);
    });
  });
});
</script>
</body>
</html>`;
}
