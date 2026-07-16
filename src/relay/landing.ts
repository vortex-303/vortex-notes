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

  .demo { display:block; width:100%; max-width:40rem; margin:1.4rem 0 0; border-radius:12px;
    border:1px solid var(--line); }
  .ctarow { display:flex; gap:0.7rem; flex-wrap:wrap; align-items:center; margin-bottom:0.4rem; }
  .cta.big { font-size:1.02rem; padding:0.85rem 1.7rem; box-shadow:0 6px 20px rgba(20,115,92,0.28); }
  .cta.big:hover { transform:translateY(-1px); }
  nav.top a.navcta { background:var(--accent); color:#fff; padding:0.32rem 0.85rem; border-radius:999px; font-weight:600; }
  [data-theme="dark"] nav.top a.navcta, @media (prefers-color-scheme: dark){ nav.top a.navcta { color:#10211C; } }

  /* animated app mock */
  .mock { margin:2rem 0 0; border:1px solid var(--line); border-radius:14px; overflow:hidden;
    background:var(--surface); box-shadow:0 24px 60px rgba(0,0,0,0.14); max-width:41rem; }
  .mockbar { display:flex; align-items:center; gap:0.4rem; padding:0.6rem 0.9rem; border-bottom:1px solid var(--line); }
  .mockbar .dot { width:9px; height:9px; border-radius:50%; }
  .dot.r{background:#E06B5C}.dot.y{background:#E0B65C}.dot.g{background:#5CC98A}
  .mocktitle { margin-left:auto; margin-right:auto; display:flex; align-items:center; gap:0.35rem;
    font:600 0.72rem var(--sans); color:var(--ink-soft); }
  .mocktitle b{color:var(--accent)} .mocktitle svg{width:14px;height:14px;color:var(--accent)}
  .mockbody { display:flex; min-height:270px; }
  .mockside { width:34%; border-right:1px solid var(--line); padding:0.7rem 0.5rem; background:var(--ground); }
  .sfolder { font:600 0.55rem var(--mono); letter-spacing:0.1em; text-transform:uppercase; color:var(--ink-faint); padding:0.5rem 0.5rem 0.25rem; }
  .snote { font-size:0.78rem; color:var(--ink-soft); padding:0.28rem 0.5rem; border-radius:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .snote.active { background:var(--accent-soft); color:var(--accent); font-weight:600; }
  .mocknote { flex:1; padding:1.3rem 1.5rem; position:relative; font-family:var(--serif); }
  .mocknote .mh1 { font:700 1.35rem var(--serif); letter-spacing:-0.01em; }
  .mocknote .mmeta { font:0.62rem var(--mono); color:var(--ink-faint); margin:0.3rem 0 1rem; }
  .ml { font:1rem/1.6 var(--serif); color:var(--ink); opacity:0; transform:translateY(3px);
    animation:reveal 13s infinite; }
  .ml.h2 { font-weight:700; font-size:1.1rem; margin-top:0.8rem; }
  .ml.b { color:var(--ink-soft); } .ml .bul { color:var(--accent); margin-right:0.4rem; }
  .ml.agent { font-size:0.8rem; color:var(--ink-faint); margin-top:0.9rem; position:relative; padding-left:0.7rem; }
  .ml.agent .tint { position:absolute; left:0; top:0.15em; bottom:0.15em; width:2px; background:var(--accent); border-radius:2px; }
  .ml.agent .who { color:var(--accent); font-weight:600; }
  .l1{animation-delay:0.4s}.l2{animation-delay:1.5s}.l3{animation-delay:2.8s}
  .l4{animation-delay:3.8s}.l5{animation-delay:4.7s}.l6{animation-delay:6.0s}
  @keyframes reveal { 0%,3%{opacity:0;transform:translateY(3px)} 8%,88%{opacity:1;transform:none} 94%,100%{opacity:0} }
  .mcaret { display:inline-block; width:2px; height:1.05rem; background:var(--accent); vertical-align:-2px;
    animation:cblink 1s steps(1) infinite; margin-left:1px; }
  @keyframes cblink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
  @media (prefers-reduced-motion: reduce) { .ml{opacity:1;transform:none;animation:none} .mcaret{animation:none} }
  @media (max-width:600px) { .mockbody{min-height:230px} .mockside{width:40%} .mocknote{padding:1rem} }
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
  .tabbar { display:none; }

  /* Mobile: app shell — no page scroll, bottom tabs switch full-height panels */
  @media (max-width:720px) {
    html, body { height:100dvh; overflow:hidden; }
    body { display:flex; flex-direction:column; }
    nav.top { position:static; }
    nav.top .in a.dlink { display:none; }
    .page { flex:1; min-height:0; display:flex; flex-direction:column; padding:0 1.2rem; }
    section.door { display:none; }
    section.door.active { display:block; flex:1; min-height:0; overflow-y:auto;
      -webkit-overflow-scrolling:touch; padding:0.4rem 0.2rem 2.5rem; }
    header.hero { padding:1.6rem 0 0; }
    h1 { font-size:1.7rem; }
    .tagline { font-size:0.98rem; }
    .promise { font-size:0.85rem; margin-top:1.4rem; }
    .k { margin-top:1.4rem; }
    footer { display:none; }
    .tabbar { display:flex; flex:none; background:var(--surface); border-top:1px solid var(--line);
      padding:0.35rem 0.4rem calc(0.35rem + env(safe-area-inset-bottom)); }
    .tabbar button { flex:1; background:none; border:none; color:var(--ink-faint); cursor:pointer;
      font:500 1.05rem var(--sans); padding:0.3rem 0; border-radius:9px; display:flex;
      flex-direction:column; align-items:center; gap:0.1rem; }
    .tabbar button span { font:600 0.6rem var(--mono); letter-spacing:0.06em; text-transform:uppercase; }
    .tabbar button.on { color:var(--accent); background:var(--accent-soft); }
  }
</style>
</head>
<body>
<nav class="top"><div class="in">
  <span class="navmark"><span class="mark" aria-hidden="true">${MARK}</span><span><span class="vx">Vortex</span> Notes</span></span>
  <a class="dlink" href="#you">For you</a><a class="dlink" href="#agents">For agents</a><a class="dlink" href="#selfhost">Self-host</a><a class="navcta" href="/app">Open app →</a>
</div></nav>
<div class="page">

<section class="door active" id="home">
<header class="hero">
  <span class="mark" aria-hidden="true">${MARK}</span>
  <h1>Your notes. Your agents' memory. One encrypted place.</h1>
  <p class="tagline">Plain-markdown notes that you and your AI agents share — synced end-to-end
  encrypted, searchable on-device, editable everywhere with live-preview markdown.
  Agents get their own keys: scoped, attributed, revocable.</p>
  <div class="ctarow">
    <a class="cta big" href="/app">Open the app →</a>
    <a class="cta ghost" href="https://www.npmjs.com/package/vortex-notes">Install the CLI</a>
  </div>
  <div class="mock" aria-hidden="true">
    <div class="mockbar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
      <span class="mocktitle">${MARK}<b>Vortex</b> Notes</span></div>
    <div class="mockbody">
      <div class="mockside">
        <div class="sfolder">· personal</div>
        <div class="snote">Reading list</div>
        <div class="snote active">La Próxima Década</div>
        <div class="snote">🔒 Diario</div>
        <div class="sfolder">daily</div>
        <div class="snote">2026-07-16</div>
      </div>
      <div class="mocknote">
        <div class="mh1">La Próxima Década</div>
        <div class="mmeta">edited today · #poetry #future</div>
        <div class="ml l1">La pantalla aún brilla, pero la mano ha cambiado —</div>
        <div class="ml l2">ya no el amo, ya no el esclavo.</div>
        <div class="ml h2 l3">Sobre el trabajo</div>
        <div class="ml b l4"><span class="bul">•</span> una máquina aprende a pensar</div>
        <div class="ml b l5"><span class="bul">•</span> y a fingir que recuerda</div>
        <div class="ml agent l6"><span class="tint"></span>anotado por <span class="who">✦ hermes</span> · anoche</div>
        <span class="mcaret"></span>
      </div>
    </div>
  </div>
  <div class="promise"><strong>This server stores ciphertext only.</strong> Your 12-word recovery
  phrase is your whole identity — keys are derived in your browser or on your devices, never here.
  There is no password reset, because there is nothing here to reset.</div>
</header>
</section>

<section class="door" id="you">
<span class="k">Door 1 · For you</span>
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

</section>
<section class="door" id="agents">
<span class="k">Door 2 · For your agents</span>
<h2>Agents are principals, not passengers</h2>
<p>An agent gets <strong>its own key</strong> — generated on its machine, never transmitted —
certified by yours, scoped to the spaces you grant, read-only if you say so. Every edit it makes
is signed as the agent. Revoking takes one tap.</p>

<h3>Connect any agent machine — one command, nothing to configure</h3>
<div class="codewrap"><pre>npx vortex-notes pair</pre><button class="copy">copy</button></div>
    <img class="demo" src="/demo.svg" alt="install, cross-lingual search, pair an agent" width="740">
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
    <p><code>npx vortex-notes pair</code> on the Hermes machine wires it in automatically once you
    approve — then just type <code>/reload-mcp</code> in your Hermes chat.</p>
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

</section>
<section class="door" id="selfhost">
<span class="k">Door 3 · Self-host</span>
<h2>Don't trust us — run your own</h2>
<div class="codewrap"><pre>vortex-notes relay --port 7300 --db ~/relay.db</pre><button class="copy">copy</button></div>
<p class="note">That's the entire server: it serves this page, the app, and an append-only log of
encrypted blobs it cannot read. Point every command above at it with <code>--relay</code>. MIT licensed.</p>

</section>

<footer>Vortex Notes · MIT ·
  <a href="https://github.com/vortex-303/vortex-notes">GitHub</a> ·
  <a href="https://www.npmjs.com/package/vortex-notes">npm</a> ·
  zero plaintext on this server, by design</footer>
</div>
<nav class="tabbar" aria-label="Sections">
  <button data-t="home" class="on">⌂<span>Home</span></button>
  <button data-t="you">✎<span>For you</span></button>
  <button data-t="agents">🤖<span>Agents</span></button>
  <button data-t="selfhost">⚙<span>Self-host</span></button>
</nav>
<script nonce="${nonce}">
var doorTabs = document.querySelectorAll(".tabbar button");
doorTabs.forEach(function (b) {
  b.addEventListener("click", function () {
    document.querySelectorAll("section.door").forEach(function (sec) {
      sec.classList.toggle("active", sec.id === b.dataset.t);
    });
    doorTabs.forEach(function (x) { x.classList.toggle("on", x === b); });
    var open = document.querySelector("section.door.active");
    if (open) open.scrollTop = 0;
  });
});
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
