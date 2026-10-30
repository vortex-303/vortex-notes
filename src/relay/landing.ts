/** The landing/docs page served at the relay root ("/"). Static, self-contained. */
import { icon } from "../icons.js";
import { MARK, FAVICON_HREF } from "./brand.js";

const RELAY = "https://vortex-notes.pages.dev";
/** The page is served by every relay; examples show the URL of the one serving it. */
const ORIGIN = "__VORTEX_ORIGIN__";



const code = (text: string) => `<div class="codewrap"><pre>${text}</pre><button class="copy">copy</button></div>`;

// Shared first steps, repeated in each panel so every panel stands alone (and works without JS).
const CONNECTOR_STEP = `<li>In <a href="/app">the app</a>: user menu (bottom left) → <em>Agents &amp; devices</em> →
  <em>Connect a chat app</em> → name it, pick <em>Read + write</em> or <em>Read-only</em> →
  <em>Create connector</em> → <em>Copy URL</em>. It looks like <code>${ORIGIN}/mcp/3f9a…</code>.
  Treat it like a password.</li>`;
const PAIR_STEP = `<li>On the machine where the agent runs (Node 20+; SSH is fine):
  ${code("npx -y vortex-notes@latest pair")}</li>
  <li>Approve the 6-letter code it shows: in the app, user menu → <em>Agents &amp; devices</em> →
  <em>Pair an agent</em>. Keys are made on that machine and never leave it.</li>`;
const CHAT_NOTE = `<p class="fine">Chat apps can only reach a server, so this server holds the connector's key and
  can read the notes it may see. Make one connector per app so you can revoke each on its own.</p>`;

// "Where does your AI live?" — one chip per client, one panel each.
const PANELS: { id: string; group: string; label: string; sub: string; body: string }[] = [
  {
    id: "claude", group: "Chat apps", label: "Claude", sub: "web · desktop · phone",
    body: `<ol class="steps">${CONNECTOR_STEP}
  <li>On claude.ai: <em>Settings</em> → <em>Connectors</em> → <em>Add</em> → custom connector. Name it
    <code>Vortex Notes</code>, paste the URL, keep <em>No sign-in</em> (the URL is the key) → <em>Add</em>.</li>
  <li>In a chat, turn it on from the tools menu and ask: “search my notes for …” or “remember that …”.</li>
</ol><p class="fine">Added once, it works in Claude on the web, the desktop app and your phone.</p>${CHAT_NOTE}`,
  },
  {
    id: "chatgpt", group: "Chat apps", label: "ChatGPT", sub: "developer mode",
    body: `<ol class="steps">${CONNECTOR_STEP}
  <li><em>Settings</em> → <em>Apps &amp; Connectors</em> → <em>Advanced settings</em> → turn on <em>Developer mode</em>.</li>
  <li>Back in <em>Apps &amp; Connectors</em> → <em>Create</em>. Name: <code>Vortex Notes</code>. MCP server URL:
    your connector URL. Authentication: <em>No authentication</em> → <em>Create</em>. (A note that it
    couldn't discover OAuth settings is expected: the URL is the key.)</li>
  <li>In a chat: <em>+</em> → <em>Developer mode</em> → turn on Vortex Notes, then ask away.</li>
</ol><p class="fine">Developer mode is on ChatGPT's paid plans.</p>${CHAT_NOTE}`,
  },
  {
    id: "claude-code", group: "On your computer", label: "Claude Code", sub: "set up for you",
    body: `<ol class="steps">${PAIR_STEP}
  <li>Restart Claude Code. <code>/mcp</code> shows vortex-notes connected in every project. Ask:
    “what do my notes say about …”.</li>
</ol>`,
  },
  {
    id: "hermes", group: "On your computer", label: "Hermes", sub: "set up for you",
    body: `<ol class="steps">${PAIR_STEP}
  <li>In your Hermes chat, type <code>/reload-mcp</code>.</li>
</ol>`,
  },
  {
    id: "opencode", group: "On your computer", label: "OpenCode", sub: "set up for you",
    body: `<ol class="steps">${PAIR_STEP}
  <li>Restart OpenCode. The server is in <code>~/.config/opencode/opencode.json</code>.</li>
</ol>`,
  },
  {
    id: "mcp", group: "On your computer", label: "Cursor · any MCP app", sub: "one config entry",
    body: `<ol class="steps">${PAIR_STEP}
  <li>Add this to the app's MCP config (Cursor: <code>~/.cursor/mcp.json</code>). <code>pair</code> prints it with
    your vault path filled in:
  ${code(`{ "mcpServers": { "vortex-notes": {
  "command": "npx", "args": ["-y", "vortex-notes", "mcp"],
  "env": { "VORTEX_NOTES_VAULT": "/path/pair/printed" } } } }`)}</li>
</ol>`,
  },
  {
    id: "shell", group: "On your computer", label: "Shell agents", sub: "OpenClaw · scripts",
    body: `<p>No MCP needed: the same tools are plain commands.</p>
${code(`npm install -g vortex-notes@latest
vortex-notes pair                    <span class="c"># approve the code in the app</span>
vortex-notes context "kiln"          <span class="c"># top notes + linked notes</span>
vortex-notes search "firing schedule"
vortex-notes remember "Kiln max is cone 8" --topic kiln
vortex-notes daily "fired the test tiles"`)}
<p class="fine">Add <code>--json</code> to any command, <code>--read-only</code> to never write. Give your agent the
<a href="https://github.com/vortex-303/vortex-notes/blob/main/launch/openclaw-skill/vortex-notes/SKILL.md">skill file</a>
(OpenClaw installs it as a skill) so it knows the commands.</p>`,
  },
  {
    id: "files", group: "Just you", label: "Your files", sub: "Obsidian · any editor",
    body: `<p>Your notes as a plain folder of markdown on your computer, kept in sync:</p>
${code(`npm install -g vortex-notes@latest
vortex-notes setup                   <span class="c"># asks your 12 words, then syncs ~/VortexNotes</span>
vortex-notes search "that idea"      <span class="c"># on-device search, any language</span>`)}
<p class="fine">Needs Node 20+. Open the folder in Obsidian or any editor. The first search downloads a
small on-device model (~120MB) once.</p>`,
  },
];

function pickerHtml(): string {
  const groups = [...new Set(PANELS.map((p) => p.group))];
  const chips = groups
    .map((g) => `<div class="chipgroup"><span class="glabel">${g}</span><div class="chips">${PANELS.filter((p) => p.group === g)
      .map((p) => `<a class="chip" href="#connect-${p.id}" data-p="${p.id}" role="tab" aria-selected="false">${p.label}</a>`)
      .join("")}</div></div>`)
    .join("");
  const panels = PANELS.map(
    (p) => `<div class="cpanel" id="connect-${p.id}" role="tabpanel">
  <h3>${p.label} <span>${p.sub}</span></h3>
  ${p.body}
</div>`
  ).join("\n");
  return `<div class="picker" role="tablist" aria-label="Where your AI runs">${chips}</div>\n${panels}`;
}

export function landingShell(nonce: string, origin = RELAY): string {
  return (`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="alternate" type="text/plain" title="Guide for AI assistants" href="/llms.txt">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F8FAF8">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121715">
<meta name="description" content="Shared memory for you and your AI: markdown notes that Claude, ChatGPT and your agents can search and write, end-to-end encrypted, with a revocable key per agent.">
<title>Vortex Notes — shared memory for you and your AI</title>
<link rel="icon" href="${FAVICON_HREF}">
<style>
  :root {
    --ground:#F8FAF8; --surface:#FFFFFF; --ink:#1D2421; --ink-soft:#4A554F; --ink-faint:#75817A;
    --line:#DFE6E1; --accent:#14735C; --accent-soft:#E3F0EB; --on-accent:#FFFFFF; --code-bg:#0E1513; --code-ink:#C9E5DB;
    --mono:ui-monospace,"SF Mono",Menlo,monospace;
    --serif:"Charter","Iowan Old Style",Georgia,serif;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ground:#121715; --surface:#1A211E; --ink:#E6ECE8; --ink-soft:#ACB8B1; --ink-faint:#7D8A83;
      --line:#2C3531; --accent:#4CC2A0; --accent-soft:#1C2F29; --on-accent:#10211C; }
  }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; scroll-padding-top:4rem; }
  body { margin:0; background:var(--ground); color:var(--ink); font:17px/1.62 var(--sans); }
  .page { max-width:46rem; margin:0 auto; padding:0 1.4rem 6rem; }
  a { color:var(--accent); }

  nav.top { position:sticky; top:0; z-index:10; background:color-mix(in srgb, var(--ground) 88%, transparent);
    backdrop-filter:blur(10px); border-bottom:1px solid var(--line); }
  nav.top .in { max-width:46rem; margin:0 auto; padding:0.55rem 1.4rem; display:flex; gap:1.1rem; align-items:center; }
  nav.top a { color:var(--ink-soft); text-decoration:none; font:500 0.8rem var(--sans); white-space:nowrap; }
  nav.top a:hover { color:var(--accent); }
  nav.top .navmark { margin-right:auto; display:flex; align-items:center; gap:0.45rem; font:600 0.85rem var(--sans); color:var(--ink); }
  nav.top .navmark .vx { color:var(--accent); }
  nav.top a.navcta { background:var(--accent); color:var(--on-accent); padding:0.32rem 0.85rem; border-radius:999px; font-weight:600; }

  .mark { color:var(--accent); display:inline-flex; }
  .mark svg { width:22px; height:22px; display:block; }
  .mark .outer, .mark .inner { transform-origin:12px 12px; }
  .mark .outer { animation:vspin 14s linear infinite; }
  .mark .inner { animation:vspin-rev 9s linear infinite; }
  @keyframes vspin { to { transform:rotate(360deg); } }
  @keyframes vspin-rev { to { transform:rotate(-360deg); } }
  @media (prefers-reduced-motion: reduce) { .mark .outer,.mark .inner { animation:none; } }

  header.hero { padding:4rem 0 0; }
  h1 { font:700 2.5rem/1.12 var(--serif); letter-spacing:-0.02em; margin:0 0 0.7rem; text-wrap:balance; }
  .tagline { color:var(--ink-soft); font-size:1.1rem; max-width:36rem; margin:0 0 1.6rem; text-wrap:pretty; }
  .ctarow { display:flex; gap:0.7rem; flex-wrap:wrap; align-items:center; }
  .cta { display:inline-block; background:var(--accent); color:var(--on-accent); text-decoration:none;
    border-radius:10px; padding:0.8rem 1.5rem; font:600 0.98rem var(--sans); }
  .cta.ghost { background:none; color:var(--accent); border:1px solid var(--accent); }

  /* animated app mock */
  .mock { margin:2.2rem 0 0; border:1px solid var(--line); border-radius:14px; overflow:hidden;
    background:var(--surface); box-shadow:0 24px 60px rgba(0,0,0,0.14); max-width:41rem; }
  .mockbar { display:flex; align-items:center; gap:0.4rem; padding:0.6rem 0.9rem; border-bottom:1px solid var(--line); }
  .mockbar .dot { width:9px; height:9px; border-radius:50%; }
  .dot.r{background:#E06B5C}.dot.y{background:#E0B65C}.dot.g{background:#5CC98A}
  .mocktitle { margin-left:auto; margin-right:auto; display:flex; align-items:center; gap:0.35rem; font:600 0.72rem var(--sans); color:var(--ink-soft); }
  .mocktitle b{color:var(--accent)} .mocktitle svg{width:14px;height:14px;color:var(--accent)}
  .mockbody { display:flex; min-height:250px; }
  .mockside { width:34%; border-right:1px solid var(--line); padding:0.7rem 0.5rem; background:var(--ground); }
  .sfolder { font:600 0.55rem var(--mono); letter-spacing:0.1em; text-transform:uppercase; color:var(--ink-faint); padding:0.5rem 0.5rem 0.25rem; }
  .snote { font-size:0.78rem; color:var(--ink-soft); padding:0.28rem 0.5rem; border-radius:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .snote.active { background:var(--accent-soft); color:var(--accent); font-weight:600; }
  .snote .mocklock { width:0.8em; height:0.8em; vertical-align:-0.1em; color:var(--ink-faint); }
  .mocknote { flex:1; min-width:0; padding:1.3rem 1.5rem; position:relative; font-family:var(--serif); }
  .mocknote .mh1 { font:700 1.35rem var(--serif); letter-spacing:-0.01em; }
  .mocknote .mmeta { font:0.62rem var(--mono); color:var(--ink-faint); margin:0.3rem 0 1rem; }
  .ml { font:1rem/1.6 var(--serif); color:var(--ink); opacity:0; transform:translateY(3px); animation:reveal 13s infinite; }
  .ml.h2 { font-weight:700; font-size:1.1rem; margin-top:0.8rem; }
  .ml.b { color:var(--ink-soft); } .ml .bul { color:var(--accent); margin-right:0.4rem; }
  .ml.agent { font-size:0.8rem; color:var(--ink-faint); margin-top:0.9rem; position:relative; padding-left:0.7rem; }
  .ml.agent .tint { position:absolute; left:0; top:0.15em; bottom:0.15em; width:2px; background:var(--accent); border-radius:2px; }
  .ml.agent .who { color:var(--accent); font-weight:600; }
  .l1{animation-delay:0.4s}.l2{animation-delay:1.5s}.l3{animation-delay:2.8s}
  .l4{animation-delay:3.8s}.l5{animation-delay:4.7s}.l6{animation-delay:6.0s}
  @keyframes reveal { 0%,3%{opacity:0;transform:translateY(3px)} 8%,88%{opacity:1;transform:none} 94%,100%{opacity:0} }
  .mcaret { display:inline-block; width:2px; height:1.05rem; background:var(--accent); vertical-align:-2px; animation:cblink 1s steps(1) infinite; margin-left:1px; }
  @keyframes cblink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
  @media (prefers-reduced-motion: reduce) { .ml{opacity:1;transform:none;animation:none} .mcaret{animation:none} }

  .k { font:600 0.62rem var(--mono); letter-spacing:0.16em; text-transform:uppercase; color:var(--accent); display:block; margin:4rem 0 0; }
  h2 { font:700 1.55rem/1.25 var(--serif); letter-spacing:-0.01em; margin:0.3rem 0 0.6rem; text-wrap:balance; }
  h3 { font:650 1.05rem var(--sans); margin:0 0 0.5rem; }
  h3 span { font:500 0.7rem var(--mono); color:var(--ink-faint); margin-left:0.45rem; }
  p { max-width:41rem; }
  .fine { font-size:0.84rem; color:var(--ink-faint); margin:0.6rem 0 0; }

  /* three benefits */
  .benefits { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:0.8rem; margin:3rem 0 0; }
  .benefit { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:1rem 1.05rem; }
  .benefit .bi { color:var(--accent); display:block; margin-bottom:0.45rem; }
  .benefit .bi svg, .benefit .bi .ic { width:20px; height:20px; }
  .benefit b { display:block; font:650 0.98rem var(--sans); margin-bottom:0.25rem; }
  .benefit p { margin:0; font-size:0.86rem; color:var(--ink-soft); line-height:1.5; }

  /* how it works */
  .how { list-style:none; padding:0; margin:1rem 0 0; display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:1.2rem; counter-reset:how; }
  .how li { counter-increment:how; border-top:2px solid var(--accent); padding-top:0.7rem; font-size:0.9rem; color:var(--ink-soft); }
  .how li::before { content:counter(how); font:600 0.72rem var(--mono); color:var(--accent); display:block; margin-bottom:0.2rem; }
  .how b { display:block; color:var(--ink); font-size:1rem; margin-bottom:0.2rem; }

  /* connect picker */
  .picker { display:flex; flex-wrap:wrap; gap:0.6rem 1.4rem; margin:1.2rem 0 1rem; }
  .chipgroup { min-width:0; }
  .glabel { display:block; font:600 0.6rem var(--mono); letter-spacing:0.12em; text-transform:uppercase; color:var(--ink-faint); margin-bottom:0.35rem; }
  .chips { display:flex; flex-wrap:wrap; gap:0.4rem; }
  .chip { font:600 0.85rem var(--sans); color:var(--ink); text-decoration:none; background:var(--surface);
    border:1px solid var(--line); border-radius:999px; padding:0.4rem 0.85rem; white-space:nowrap; }
  .chip:hover { border-color:var(--accent); }
  .chip[aria-selected="true"] { background:var(--accent); border-color:var(--accent); color:var(--on-accent); }
  .cpanel { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:1.1rem 1.25rem; margin:0 0 0.8rem; min-width:0; scroll-margin-top:5rem; }
  .js .cpanel { display:none; }
  .js .cpanel.on { display:block; }
  .cpanel p { margin:0 0 0.5rem; font-size:0.92rem; color:var(--ink-soft); }
  .cpanel code { overflow-wrap:anywhere; }
  .steps { counter-reset:st; list-style:none; padding:0; margin:0.2rem 0 0; }
  .steps li { counter-increment:st; position:relative; padding:0.35rem 0 0.35rem 2.1rem; font-size:0.92rem; color:var(--ink-soft); min-width:0; }
  .steps li::before { content:counter(st); position:absolute; left:0; top:0.45rem; font:600 0.74rem var(--mono); color:var(--accent);
    background:var(--accent-soft); border-radius:50%; width:1.45rem; height:1.45rem; display:flex; align-items:center; justify-content:center; }
  .steps em { color:var(--ink); font-style:normal; font-weight:600; }
  details { margin:0.8rem 0 0; font-size:0.9rem; color:var(--ink-soft); }
  summary { cursor:pointer; font-weight:600; color:var(--ink); }
  details > div { padding:0.5rem 0 0; }
  .demo { display:block; width:100%; max-width:40rem; border-radius:12px; border:1px solid var(--line); }

  .codewrap { position:relative; max-width:41rem; min-width:0; }
  pre { background:var(--code-bg); color:var(--code-ink); border-radius:10px; padding:0.85rem 4.2rem 0.85rem 1rem;
    overflow-x:auto; font:0.78rem/1.7 var(--mono); margin:0.5rem 0 0.6rem; }
  pre .c { color:#6E8A80; }
  .copy { position:absolute; top:0.5rem; right:0.5rem; background:rgba(255,255,255,0.08); color:#9DB8AE; border:none;
    border-radius:6px; font:0.65rem var(--mono); padding:0.3rem 0.55rem; cursor:pointer; }
  .copy:hover { color:#fff; }
  code { font:0.84em var(--mono); background:var(--ground); border:1px solid var(--line); border-radius:4px; padding:0.08em 0.35em; }

  /* privacy */
  .trust { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:0.8rem; margin:1rem 0 0; }
  .trust div { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:0.95rem 1.1rem; font-size:0.88rem; color:var(--ink-soft); }
  .trust b { display:block; color:var(--ink); margin-bottom:0.3rem; font-size:0.95rem; }
  .trust ul { margin:0; padding-left:1.1rem; }
  .trust li { margin:0.15rem 0; }
  .exception { margin:0.8rem 0 0; padding:0.85rem 1.1rem; background:var(--accent-soft); border-left:3px solid var(--accent);
    border-radius:0 8px 8px 0; font-size:0.9rem; color:var(--ink-soft); max-width:none; }
  .exception strong { color:var(--ink); }

  footer { margin-top:4.5rem; padding-top:1.5rem; border-top:1px solid var(--line); font-size:0.8rem; color:var(--ink-faint); }
  .tabbar { display:none; }
  .tabbar button .ic { width:20px; height:20px; }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }

  @media (max-width:720px) {
    .benefits, .how, .trust { grid-template-columns:minmax(0, 1fr); }
    .benefits { gap:0.6rem; margin-top:2rem; }
    .how { gap:0.9rem; }
  }
  /* Phones: app shell, no page scroll; bottom tabs switch full-height panels */
  @media (max-width:720px) {
    html, body { height:100dvh; overflow:hidden; }
    body { display:flex; flex-direction:column; }
    nav.top { position:static; }
    nav.top .in { padding:0.55rem 1.2rem; }
    nav.top .in a.dlink { display:none; }
    .macdl { display:none !important; } /* a DMG is no use on a phone */
    .page { flex:1; min-height:0; width:100%; display:flex; flex-direction:column; padding:0 1.2rem; }
    section.door { display:none; }
    section.door.active { display:block; flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:0.4rem 0.2rem 2.5rem; }
    header.hero { padding:1.6rem 0 0; }
    h1 { font-size:1.8rem; }
    .tagline { font-size:1rem; }
    .mock { margin-top:1.6rem; }
    .mockbody { min-height:220px; } .mockside { width:40%; } .mocknote { padding:1rem; }
    .k { margin-top:1.6rem; }
    .k.first { margin-top:0.6rem; }
    .cpanel { padding:0.95rem 1rem; }
    pre { padding:2rem 1rem 0.85rem; font-size:0.74rem; }
    .copy { top:0.4rem; }
    footer { display:none; }
    .tabbar { display:flex; flex:none; background:var(--surface); border-top:1px solid var(--line);
      padding:0.35rem 0.4rem calc(0.35rem + env(safe-area-inset-bottom)); }
    .tabbar button { flex:1; background:none; border:none; color:var(--ink-faint); cursor:pointer; padding:0.3rem 0;
      border-radius:9px; display:flex; flex-direction:column; align-items:center; gap:0.1rem; }
    .tabbar button span { font:600 0.6rem var(--mono); letter-spacing:0.06em; text-transform:uppercase; }
    .tabbar button.on { color:var(--accent); background:var(--accent-soft); }
  }
</style>
</head>
<body>
<nav class="top"><div class="in">
  <span class="navmark"><span class="mark" aria-hidden="true">${MARK}</span><span><span class="vx">Vortex</span> Notes</span></span>
  <a class="dlink" href="#connect">Connect your AI</a><a class="dlink" href="#trust">Privacy</a><a class="navcta" href="/app">Open app →</a>
</div></nav>
<div class="page">

<section class="door active" id="home">
<header class="hero">
  <h1>Shared memory for you and your AI.</h1>
  <p class="tagline">Markdown notes that Claude, ChatGPT and your agents can search and write.
  End-to-end encrypted, with a key for each agent that you can take back.</p>
  <div class="ctarow">
    <a class="cta" href="/app">Open the app →</a>
    <a class="cta ghost" href="#connect">Connect your AI</a>
    <a class="cta ghost macdl" href="${RELAY}/download/VortexNotes.dmg" download>Download for Mac</a>
  </div>
  <p class="fine macdl">Mac app: macOS 14 or later · free · beta · notarized by Apple</p>
  <div class="mock" aria-hidden="true">
    <div class="mockbar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
      <span class="mocktitle">${MARK}<b>Vortex</b> Notes</span></div>
    <div class="mockbody">
      <div class="mockside">
        <div class="sfolder">· personal</div>
        <div class="snote">Reading list</div>
        <div class="snote active">La Próxima Década</div>
        <div class="snote">${icon("lock", "mocklock")} Diario</div>
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
</header>

<div class="benefits">
  <div class="benefit"><span class="bi">${icon("read")}</span><b>Plain markdown you own</b>
    <p>Write in the browser or on your phone. On your computer it's a folder of .md files that Obsidian or any editor opens.</p></div>
  <div class="benefit"><span class="bi">${icon("agent")}</span><b>A key for every AI</b>
    <p>Each agent gets its own key: only the spaces you pick, read-only if you like, every edit signed. Revoke it in one tap.</p></div>
  <div class="benefit"><span class="bi">${icon("lock")}</span><b>A server that can't read it</b>
    <p>Keys come from your 12 words, on your devices. The server stores ciphertext only.</p></div>
</div>

<span class="k">How it works</span>
<ol class="how">
  <li><b>Create an account</b><a href="/app">Open the app</a> and write down your 12 words. On your phone: Share → Add to Home Screen.</li>
  <li><b>Connect your AI</b>Paste a connector URL into a chat app, or run one command on your computer.</li>
  <li><b>It remembers</b>What one AI writes, the others can find. You see who wrote what.</li>
</ol>
</section>

<section class="door" id="connect">
<span class="k first">Connect your AI</span>
<h2>Where does your AI live?</h2>
${pickerHtml()}
<details><summary>What can agents do?</summary><div>
  Search (keyword + semantic, any language), read, create and edit notes, add to today's daily note,
  remember facts (a new fact supersedes the old one, never deletes it), and load a topic's context in one call.
  Tools: <code>search_notes</code> <code>read_note</code> <code>write_note</code> <code>edit_note</code>
  <code>append_daily</code> <code>remember</code> <code>build_context</code> <code>recent_activity</code> <code>list_notes</code>.
  Revoke any agent or connector in the app: <em>Agents &amp; devices</em> → <em>Revoke</em>.
</div></details>
<details><summary>See it in a terminal</summary><div>
  <img class="demo" src="/demo.svg" alt="Installing, searching across languages, and pairing an agent" width="740" loading="lazy">
</div></details>
</section>

<section class="door" id="trust">
<span class="k first">Privacy</span>
<h2>What this server can see</h2>
<div class="trust">
  <div><b>It stores</b><ul><li>Encrypted notes it cannot open</li><li>Which device or agent sent each change, and when</li><li>Public notes you choose to publish</li></ul></div>
  <div><b>It never has</b><ul><li>Your 12 words or the keys made from them</li><li>A way to reset them: there's nothing here to reset</li><li>The keys of agents you pair on your computers</li></ul></div>
</div>
<p class="exception"><strong>The one exception is yours to make.</strong> A chat app (Claude, ChatGPT) can only
reach a server, so when you create a connector this server holds that connector's key and can read the notes it
may see. Everything else stays end-to-end encrypted.</p>
<p class="fine">Details: <a href="/privacy">privacy policy</a> · <a href="/terms">terms of use</a>.</p>

<span class="k">Self-host</span>
<h2>Or run your own</h2>
${code("vortex-notes relay --port 7300 --db ~/relay.db")}
<p class="fine">That's the whole server: this page, the web app, chat-app connectors and an append-only log of
encrypted changes. Point any command at it with <code>--relay</code>. MIT licensed.</p>
<ul class="fine">
  <li><code>--db</code> is where everything lives: back it up.</li>
  <li>For chat apps, set <code>RELAY_CONNECTOR_KEK</code> (64 hex characters) so their keys are encrypted at rest,
    and serve it over HTTPS (Caddy, nginx or a tunnel): Claude and ChatGPT can't reach <code>localhost</code>.</li>
  <li>The Mac and iPhone apps use the hosted server for now.</li>
</ul>
</section>

<footer>Vortex Notes · MIT ·
  <a href="https://github.com/vortex-303/vortex-notes">GitHub</a> ·
  <a href="https://www.npmjs.com/package/vortex-notes">npm</a> ·
  <a href="/llms.txt">llms.txt</a> ·
  <a href="/privacy">Privacy</a> ·
  <a href="/terms">Terms</a> ·
  zero plaintext on this server unless you connect a chat app</footer>
</div>
<nav class="tabbar" aria-label="Sections">
  <button data-t="home" class="on">${icon("read")}<span>Home</span></button>
  <button data-t="connect">${icon("agent")}<span>Connect</span></button>
  <button data-t="trust">${icon("lock")}<span>Privacy</span></button>
</nav>
<script nonce="${nonce}">
document.documentElement.classList.add("js");
var doorTabs = document.querySelectorAll(".tabbar button");
function openDoor(id) {
  document.querySelectorAll("section.door").forEach(function (sec) { sec.classList.toggle("active", sec.id === id); });
  doorTabs.forEach(function (x) { x.classList.toggle("on", x.dataset.t === id); });
  var open = document.querySelector("section.door.active");
  if (open) open.scrollTop = 0;
}
doorTabs.forEach(function (b) { b.addEventListener("click", function () { openDoor(b.dataset.t); }); });

var chips = document.querySelectorAll(".chip");
function pick(id) {
  if (!document.getElementById("connect-" + id)) return false;
  chips.forEach(function (c) { c.setAttribute("aria-selected", String(c.dataset.p === id)); });
  document.querySelectorAll(".cpanel").forEach(function (p) { p.classList.toggle("on", p.id === "connect-" + id); });
  return true;
}
chips.forEach(function (c) {
  c.addEventListener("click", function (e) {
    e.preventDefault();
    pick(c.dataset.p);
    history.replaceState(null, "", "#connect-" + c.dataset.p);
  });
});
pick("claude");

// Deep links: #connect-<client>, #connect, #trust (older #agents / #you / #selfhost still land somewhere sensible).
var legacy = { agents: "connect", you: "connect-files", selfhost: "trust" };
function route(hash) {
  var h = legacy[hash] || hash;
  if (h.indexOf("connect-") === 0 && pick(h.slice(8))) h = "connect";
  if (document.getElementById(h) && document.getElementById(h).classList.contains("door")) {
    openDoor(h);
    return document.getElementById(h);
  }
}
document.querySelectorAll('a[href^="#"]').forEach(function (a) {
  if (a.classList.contains("chip")) return;
  a.addEventListener("click", function () { route(a.getAttribute("href").slice(1)); });
});
function routeHash() {
  if (!location.hash) return;
  var target = route(location.hash.slice(1));
  if (target && innerWidth > 720) target.scrollIntoView();
}
addEventListener("hashchange", routeHash);
routeHash();

document.querySelectorAll(".copy").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var pre = btn.parentElement.querySelector("pre");
    var text = pre.innerText.split("\\n").map(function (l) { return l.replace(/\\s+#.*$/, "").trimEnd(); })
      .filter(function (l) { return l.length; }).join("\\n");
    navigator.clipboard.writeText(text).then(function () {
      btn.textContent = "copied";
      setTimeout(function () { btn.textContent = "copy"; }, 1500);
    });
  });
});
</script>
</body>
</html>`).replaceAll(ORIGIN, origin);
}
