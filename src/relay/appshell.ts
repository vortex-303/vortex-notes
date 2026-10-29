// The /app HTML shell — static markup + CSS; the bundle does the rest.
import { icon, ICON_CSS } from "../icons.js";

export function appShell(_nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F8FAF8">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121715">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Vortex Notes">
<link rel="apple-touch-icon" href="/app/icon-180.png">
<link rel="icon" type="image/png" sizes="192x192" href="/app/icon-192.png">
<link rel="manifest" href="/app/manifest.webmanifest">
<link rel="icon" href="data:image/svg+xml,%3Csvg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cg stroke='%2314735C' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12'/%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12' transform='rotate(120 12 12)'/%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12' transform='rotate(240 12 12)'/%3E%3C/g%3E%3Ccircle cx='12' cy='12' r='2.2' fill='%2314735C'/%3E%3C/svg%3E">
<title>Vortex Notes</title>
<style>
  :root {
    --ground:#F8FAF8; --surface:#FFFFFF; --ink:#1D2421; --ink-soft:#4A554F; --ink-faint:#75817A;
    --line:#DFE6E1; --accent:#14735C; --accent-soft:#E3F0EB; --code-bg:#F0F4F1; --danger:#A33B2E;
    --mono:ui-monospace,"SF Mono",Menlo,monospace;
    --serif:"Charter","Iowan Old Style",Georgia,serif;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  }
  [data-theme="dark"] {
    --ground:#121715; --surface:#1A211E; --ink:#E6ECE8; --ink-soft:#ACB8B1; --ink-faint:#7D8A83;
    --line:#2C3531; --accent:#4CC2A0; --accent-soft:#1C2F29; --code-bg:#202824; --danger:#E08573;
  }
  * { box-sizing:border-box; } html,body { margin:0; height:100%; }
  body { background:var(--ground); color:var(--ink); font-family:var(--sans); }

  .mark { color:var(--accent); display:inline-flex; }
  .mark svg { width:20px; height:20px; display:block; }
  .mark .outer, .mark .inner { transform-origin:12px 12px; }
  .mark .outer { animation:vspin 14s linear infinite; }
  .mark .inner { animation:vspin-rev 9s linear infinite; }
  @keyframes vspin { to { transform:rotate(360deg); } }
  @keyframes vspin-rev { to { transform:rotate(-360deg); } }
  @media (prefers-reduced-motion: reduce) { .mark .outer, .mark .inner { animation:none; } }
  .wordmark { display:flex; align-items:center; gap:0.5rem; font:400 0.92rem var(--sans); }
  .wordmark .vx { color:var(--accent); font-weight:600; }
  .wordmark .nx { color:var(--ink-soft); margin-left:-0.2rem; }

  #lock { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:1.1rem; padding:1rem; }
  #lock .wordmark { font-size:1.35rem; }
  #lock p { color:var(--ink-soft); font-size:0.85rem; max-width:26rem; text-align:center; margin:0; line-height:1.55; }
  #phrase { width:min(30rem,90vw); padding:0.7rem 0.9rem; border:1px solid var(--line); border-radius:8px;
    background:var(--surface); color:var(--ink); font:0.9rem var(--mono); outline:none; }
  #phrase:focus { border-color:var(--accent); }
  #unlockBtn { background:var(--accent); color:#fff; border:none; border-radius:8px; padding:0.6rem 1.5rem;
    font:600 0.85rem var(--sans); cursor:pointer; }
  [data-theme="dark"] #unlockBtn { color:#10211C; }
  #status { font:0.75rem var(--mono); color:var(--ink-faint); min-height:1.2em; max-width:30rem; text-align:center; }
  #unlockView, #createView { display:flex; flex-direction:column; align-items:center; gap:1.1rem; }
  #createView[hidden], #unlockView[hidden] { display:none; }
  .linkbtn { background:none; border:none; color:var(--accent); font:0.8rem var(--sans);
    cursor:pointer; text-decoration:underline; text-underline-offset:3px; padding:0.4rem; }
  .phrasebox { max-width:min(30rem,90vw); background:var(--surface); border:1px solid var(--accent);
    border-radius:10px; padding:1rem 1.2rem; font:600 1rem/1.9 var(--mono); color:var(--ink);
    text-align:center; user-select:all; -webkit-user-select:all; }
  .confirmrow { display:flex; gap:0.6rem; align-items:center; font-size:0.85rem; color:var(--ink-soft); cursor:pointer; }
  .confirmrow input { width:20px; height:20px; accent-color:var(--accent); }
  #createBtn { background:var(--accent); color:#fff; border:none; border-radius:8px; padding:0.6rem 1.5rem;
    font:600 0.85rem var(--sans); cursor:pointer; }
  #createBtn:disabled { opacity:0.45; cursor:default; }
  [data-theme="dark"] #createBtn { color:#10211C; }

  #main { display:none; height:100vh; }
  aside { width:290px; flex:none; background:var(--surface); border-right:1px solid var(--line);
    display:flex; flex-direction:column; overflow:hidden; }
  .bar { display:flex; gap:0.4rem; align-items:center; padding:0.95rem 1rem 0.7rem; }
  .bar .wordmark { margin-right:auto; }
  .iconbtn { background:none; border:1px solid var(--line); border-radius:6px; color:var(--ink-soft);
    height:27px; min-width:27px; cursor:pointer; font-size:0.85rem; padding:0 0.35rem; }
  .iconbtn:hover { border-color:var(--accent); color:var(--accent); }
  ${ICON_CSS}
  .iconbtn { display:inline-flex; align-items:center; justify-content:center; }
  .iconbtn .ic { width:18px; height:18px; }
  .menuitem .ic { width:16px; height:16px; color:var(--ink-faint); margin-right:0.1rem; }
  .mbtn { display:inline-flex; align-items:center; gap:0.3rem; }
  .mbtn .ic { width:15px; height:15px; }
  .notemenu .menuitem { display:flex; align-items:center; gap:0.5rem; }
  .notemenu .menuitem .ic { width:16px; height:16px; color:var(--ink-faint); }
  .listlock { width:0.85em; height:0.85em; color:var(--ink-faint); vertical-align:-0.12em; }
  .lockscreen .lockicon .ic { width:2rem; height:2rem; color:var(--ink-faint); }
  .backbtn .ic { width:14px; height:14px; }
  .menuitem:hover .ic, .menuitem:hover { color:var(--accent); }
  /* bottom-left user menu */
  .usermenuwrap { position:relative; border-top:1px solid var(--line); flex:none; }
  .usertrigger { display:flex; align-items:center; gap:0.55rem; width:100%; padding:0.7rem 1rem;
    background:none; border:none; cursor:pointer; color:var(--ink); text-align:left; }
  .usertrigger:hover { background:var(--ground); }
  .avatar { width:26px; height:26px; border-radius:7px; flex:none; overflow:hidden;
    display:inline-flex; background:var(--accent-soft); }
  .avatar svg { width:100%; height:100%; display:block; }
  .uname { font:600 0.82rem var(--sans); margin-right:auto; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; max-width:12rem; }
  .umore { color:var(--ink-faint); width:1rem; height:1rem; }
  .usermenu { position:absolute; bottom:calc(100% + 4px); left:0.6rem; right:0.6rem; z-index:20;
    background:var(--surface); border:1px solid var(--line); border-radius:11px;
    box-shadow:0 12px 34px rgba(0,0,0,0.2); padding:0.25rem; }
  .usermenu[hidden] { display:none; }
  [hidden] { display:none !important; }
  .umsection { padding:0.15rem; } .umsection + .umsection { border-top:1px solid var(--line); }
  .usermenu .menuitem { display:flex; align-items:center; gap:0.6rem; width:100%; text-align:left;
    background:none; border:none; color:var(--ink); font:0.85rem var(--sans); padding:0.55rem 0.7rem;
    border-radius:7px; cursor:pointer; }
  .usermenu .menuitem:hover { background:var(--accent-soft); }
  .usermenu .menuitem.static { cursor:default; } .usermenu .menuitem.static:hover { background:none; }
  .umval { margin-left:auto; color:var(--ink-faint); font:0.72rem var(--mono); }
  .agentslist { display:flex; flex-direction:column; gap:0.5rem; margin:0.6rem 0; }
  .agentrow { display:flex; align-items:center; gap:0.6rem; padding:0.6rem 0.7rem;
    border:1px solid var(--line); border-radius:9px; }
  .agentrow .ic { width:18px; height:18px; color:var(--ink-faint); }
  .agentrow .an { font:600 0.85rem var(--sans); }
  .agentrow .am { font:0.68rem var(--mono); color:var(--ink-faint); }
  .agentrow .col { flex:1; min-width:0; } .agentrow .col > * { display:block; }
  #adminOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:56;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #adminOverlay[hidden] { display:none; }
  #adminModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:26rem; width:100%; padding:1.1rem 1.25rem 1.25rem; box-shadow:0 18px 50px rgba(0,0,0,0.35); }
  .admingrid { display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-top:0.6rem; }
  .statcard { border:1px solid var(--line); border-radius:9px; padding:0.6rem 0.75rem; }
  .statcard b { display:block; font:700 1.25rem var(--sans); font-variant-numeric:tabular-nums; }
  .statcard span { font:600 0.6rem var(--mono); letter-spacing:0.1em; text-transform:uppercase; color:var(--ink-faint); }
  .countries { display:flex; flex-wrap:wrap; gap:0.35rem; }
  .ctag { font:600 0.72rem var(--mono); border:1px solid var(--line); border-radius:99px; padding:0.15rem 0.55rem; }
  .ctag b { color:var(--accent); font-weight:700; }
  .adminaccts { max-height:16rem; overflow-y:auto; display:flex; flex-direction:column; gap:0.45rem; }
  .adrow { border:1px solid var(--line); border-radius:9px; padding:0.5rem 0.65rem; }
  .adrow .l1 { display:flex; align-items:center; gap:0.5rem; }
  .adrow code { font:600 0.72rem var(--mono); }
  .adrow .meta { font:0.68rem var(--mono); color:var(--ink-faint); margin-top:0.2rem; word-break:break-word; }
  .tagchip { font:600 0.58rem var(--mono); letter-spacing:0.08em; text-transform:uppercase; border-radius:99px;
    padding:0.12rem 0.5rem; border:1px solid var(--line); color:var(--ink-faint); }
  .tagchip.new { color:var(--accent); border-color:var(--accent); }
  .tagbtns { margin-left:auto; display:flex; gap:0.25rem; }
  .tagbtns button { font:600 0.62rem var(--mono); background:none; border:1px solid var(--line); border-radius:6px;
    color:var(--ink-faint); padding:0.18rem 0.45rem; cursor:pointer; }
  .tagbtns button:hover { color:var(--accent); border-color:var(--accent); }
  #histOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:58;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #histOverlay[hidden] { display:none; }
  #histModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:30rem; width:100%; max-height:85dvh; overflow-y:auto;
    padding:1.1rem 1.25rem 1.25rem; box-shadow:0 18px 50px rgba(0,0,0,0.35); }
  .histlist { max-height:11rem; overflow-y:auto; display:flex; flex-direction:column; gap:0.3rem; margin-top:0.5rem; }
  .histrow { display:flex; align-items:center; gap:0.5rem; width:100%; text-align:left; cursor:pointer;
    background:none; border:1px solid var(--line); border-radius:8px; padding:0.45rem 0.6rem; color:var(--ink); }
  .histrow:hover, .histrow.sel { border-color:var(--accent); }
  .histrow .hwhen { font:600 0.72rem var(--mono); }
  .histrow .hmeta { margin-left:auto; font:0.66rem var(--mono); color:var(--ink-faint); }
  .tagchip.open { color:var(--accent); border-color:var(--accent); }
  .histpreview { margin-top:0.7rem; }
  .histarticle { border:1px solid var(--line); border-radius:9px; padding:0.7rem 0.9rem;
    max-height:14rem; overflow-y:auto; font-size:0.85rem; }
  .lostpw { background:none; border:none; color:var(--ink-faint); font:0.75rem var(--sans);
    text-decoration:underline; cursor:pointer; margin-top:0.9rem; }
  .lostpw:hover { color:var(--accent); }
  @media (max-width:720px) {
    #histOverlay { align-items:flex-end; padding:0; }
    #histModal { border-radius:16px 16px 0 0; max-width:none; padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }
  @media (max-width:720px) {
    #adminOverlay { align-items:flex-end; padding:0; }
    #adminModal { border-radius:16px 16px 0 0; max-width:none; padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); max-height:85dvh; overflow-y:auto; }
  }
  #agentsOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:56;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #agentsOverlay[hidden] { display:none; }
  #agentsModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:27rem; width:100%; max-height:86dvh; overflow-y:auto; padding:1.1rem 1.25rem 1.25rem;
    box-shadow:0 18px 50px rgba(0,0,0,0.35); }
  @media (max-width:720px) {
    #agentsOverlay { align-items:flex-end; padding:0; }
    #agentsModal { border-radius:16px 16px 0 0; max-width:none; padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }
  .menuwrap { position:relative; }
  .menu { position:absolute; right:0; top:calc(100% + 6px); z-index:20; min-width:11.5rem;
    background:var(--surface); border:1px solid var(--line); border-radius:10px;
    box-shadow:0 8px 28px rgba(0,0,0,0.18); padding:0.35rem; }
  .menuitem { display:block; width:100%; text-align:left; background:none; border:none;
    color:var(--ink); font:0.88rem var(--sans); padding:0.65rem 0.8rem; border-radius:7px;
    cursor:pointer; }
  .menuitem:hover { background:var(--accent-soft); color:var(--accent); }
  #filter { margin:0 1rem 0.6rem; padding:0.48rem 0.7rem; border:1px solid var(--line); border-radius:7px;
    background:var(--ground); color:var(--ink); font:0.83rem var(--sans); outline:none; }
  #filter:focus { border-color:var(--accent); }
  #list { flex:1 1 0; min-height:0; overflow-y:auto; padding:0 0.5rem 1rem; }
  .folder { font:600 0.62rem var(--mono); letter-spacing:0.12em; text-transform:uppercase;
    color:var(--ink-faint); padding:0.9rem 0.5rem 0.3rem; }
  #list a { display:block; padding:0.32rem 0.5rem; border-radius:6px; color:var(--ink-soft); font-size:0.86rem;
    text-decoration:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #list a:hover { background:var(--accent-soft); color:var(--ink); }
  #list a.active { background:var(--accent-soft); color:var(--accent); font-weight:600; }
  .empty { color:var(--ink-faint); font-size:0.8rem; padding:0.5rem; }
  .dailybox { padding:0.75rem 1rem; border-top:1px solid var(--line); }
  .dailybox label { display:block; font:600 0.6rem var(--mono); letter-spacing:0.12em; text-transform:uppercase;
    color:var(--ink-faint); margin-bottom:0.35rem; }
  .dailybox input { width:100%; padding:0.45rem 0.65rem; border:1px solid var(--line); border-radius:7px;
    background:var(--ground); color:var(--ink); font:0.8rem var(--sans); outline:none; }
  .dailybox input:focus { border-color:var(--accent); }

  main.pane { flex:1; overflow-y:auto; }
  #note { position:relative; max-width:46rem; margin:0 auto; padding:3rem 2.2rem 6rem; }
  .placeholder { color:var(--ink-faint); font:1rem var(--serif); font-style:italic; margin-top:30vh; text-align:center; }
  .notehead { border-bottom:1px solid var(--line); padding-bottom:1rem; margin-bottom:1.6rem; }
  .notehead .meta { font:0.7rem var(--mono); color:var(--ink-faint); letter-spacing:0.05em;
    display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap; }
  .notehead .meta .path { margin-right:auto; }
  .notehead h1 { font:700 2rem/1.15 var(--serif); letter-spacing:-0.015em; margin:0.4rem 0 0; }
  .notemeta { font:0.72rem/1.5 var(--mono); color:var(--ink-faint); margin-top:0.45rem; letter-spacing:0.02em; }
  .lockscreen { text-align:center; margin-top:14vh; display:flex; flex-direction:column;
    align-items:center; gap:0.8rem; }
  .lockscreen .lockicon { font-size:2.2rem; }
  .lockscreen p { color:var(--ink-soft); margin:0; }
  .lockscreen input { width:min(20rem,80vw); padding:0.6rem 0.9rem; border:1px solid var(--line);
    border-radius:8px; background:var(--surface); color:var(--ink); font:1rem var(--sans); outline:none; text-align:center; }
  .lockscreen input:focus { border-color:var(--accent); }
  .lockscreen textarea { width:min(20rem,80vw); padding:0.6rem 0.9rem; border:1px solid var(--line);
    border-radius:9px; background:var(--bg); color:var(--ink); font:0.85rem var(--mono); resize:none; }
  .lockscreen textarea:focus { border-color:var(--accent); outline:none; }
  #phraseRow { display:flex; flex-direction:column; align-items:center; gap:0.5rem; margin-top:0.5rem; }
  #phraseRow[hidden] { display:none; }
  .lockerr { font:0.8rem var(--mono); color:var(--danger); min-height:1.2em; }
  .moremenu { position:relative; display:inline-flex; }
  .notemenu { position:absolute; top:calc(100% + 6px); right:0; z-index:20; min-width:12rem;
    background:var(--surface); border:1px solid var(--line); border-radius:10px;
    box-shadow:0 8px 28px rgba(0,0,0,0.18); padding:0.35rem; }
  .notemenu[hidden] { display:none; }
  .notemenu .menuitem { display:block; width:100%; text-align:left; background:none; border:none;
    color:var(--ink); font:0.85rem var(--sans); padding:0.6rem 0.75rem; border-radius:7px; cursor:pointer; }
  .notemenu .menuitem:hover { background:var(--accent-soft); color:var(--accent); }
  .mbtn { background:none; border:1px solid var(--line); border-radius:6px; color:var(--ink-soft);
    font:0.68rem var(--mono); padding:0.2rem 0.55rem; cursor:pointer; }
  .mbtn:hover { border-color:var(--accent); color:var(--accent); }
  .mbtn.danger:hover { border-color:var(--danger); color:var(--danger); }
  .mbtn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  [data-theme="dark"] .mbtn.primary { color:#10211C; }

  article { font:1.02rem/1.68 var(--serif); cursor:text; }
  #savestate { font:0.68rem var(--mono); color:var(--ink-faint); }
  .backbtn { display:none; }
  article h1, article h2, article h3, article h4 { font-family:var(--serif); letter-spacing:-0.01em;
    line-height:1.25; margin:1.8em 0 0.5em; }
  article h1 { font-size:1.55rem; } article h2 { font-size:1.3rem; } article h3 { font-size:1.1rem; }
  article p { margin:0 0 1em; }
  article a { color:var(--accent); }
  article code { font:0.85em var(--mono); background:var(--code-bg); border-radius:4px; padding:0.1em 0.35em; }
  article pre { background:var(--code-bg); border:1px solid var(--line); border-radius:8px; padding:1rem 1.2rem; overflow-x:auto; }
  article pre code { background:none; padding:0; }
  article blockquote { margin:1em 0; padding:0.1em 1.2em; border-left:3px solid var(--accent); color:var(--ink-soft); }
  article img { max-width:100%; border-radius:6px; }
  article hr { border:none; border-top:1px solid var(--line); margin:2em 0; }
  article table { border-collapse:collapse; width:100%; font-size:0.92rem; }
  article th, article td { border:1px solid var(--line); padding:0.45rem 0.7rem; text-align:left; }
  article th { background:var(--code-bg); font-family:var(--sans); font-size:0.8rem; }
  article ul, article ol { padding-left:1.5rem; }
  article li { margin-bottom:0.3em; }
  article del { color:var(--ink-faint); }
  article input[type=checkbox] { accent-color:var(--accent); }
  pre.rawview { font:0.82rem/1.6 var(--mono); white-space:pre-wrap; word-break:break-word; }

  /* Live editor: invisible chrome — the note is the editing surface */
  #cm { border:none; background:transparent; }
  #cm .cm-editor { min-height:55vh; }
  .cm-bullet { color:var(--accent); display:inline-block; width:1em; }
  .cm-wikilink { color:var(--accent); border-bottom:1px solid var(--accent); cursor:pointer; }
  .cm-frontmatter { font:0.7rem var(--mono); color:var(--ink-faint); letter-spacing:0.05em;
    padding:0.25rem 0 0.6rem; cursor:pointer; user-select:none; }
  .cm-frontmatter:hover { color:var(--accent); }
  .editnote { font:0.72rem var(--mono); color:var(--ink-faint); margin-top:0.5rem; }

  #acctOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:50;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #acctOverlay[hidden] { display:none; }
  #acctModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:27rem; width:100%; padding:1.1rem 1.25rem 1.25rem; box-shadow:0 18px 50px rgba(0,0,0,0.3); }
  .acctphrase { margin:0.8rem 0; }
  .acctlabel { font:600 0.6rem var(--mono); letter-spacing:0.12em; text-transform:uppercase;
    color:var(--ink-faint); margin-bottom:0.4rem; }
  #phraseReveal.blurred { filter:blur(6px); cursor:pointer; user-select:none; color:var(--ink-faint); }
  .acctrow { display:flex; gap:1rem; margin-top:0.5rem; }
  @media (max-width:720px) {
    #acctOverlay { align-items:flex-end; padding:0; }
    #acctModal { border-radius:16px 16px 0 0; max-width:none;
      padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }
  #pubOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:55;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #pubOverlay[hidden] { display:none; }
  #pubModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:27rem; width:100%; max-height:88dvh; overflow-y:auto;
    padding:1.1rem 1.25rem 1.25rem; box-shadow:0 18px 50px rgba(0,0,0,0.35); }
  .pubname { border:none; border-bottom:1px solid var(--line); background:none; color:var(--ink);
    font:0.9rem var(--sans); outline:none; padding:0.2rem 0.1rem; width:14rem; }
  .pubname:focus { border-bottom-color:var(--accent); }
  .themerow { display:flex; gap:0.6rem; margin-top:0.3rem; }
  .themecard { flex:1; border:1px solid var(--line); border-radius:10px; padding:1.5rem 0.4rem 0.5rem;
    text-align:center; cursor:pointer; font:600 0.68rem var(--mono); position:relative; overflow:hidden; }
  .themecard input { position:absolute; opacity:0; }
  .themecard span { position:relative; z-index:1; }
  .themecard:has(input:checked) { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
  .t-manuscript { background:linear-gradient(174deg,#f4ead2,#e7d7b2); color:#5a4a28; }
  .t-vortex { background:radial-gradient(circle at 50% 0%,#12211c,#090f0d); color:#4CC2A0; }
  .t-typewriter { background:linear-gradient(180deg,#fbfaf5,#f0ede2); color:#b3382c; }
  .publink { display:flex; align-items:center; gap:0.6rem; }
  .publink a { color:var(--accent); font:0.8rem var(--mono); word-break:break-all; }
  @media (max-width:720px) {
    #pubOverlay { align-items:flex-end; padding:0; }
    #pubModal { border-radius:16px 16px 0 0; max-width:none; padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }
  #pwOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:60;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #pwOverlay[hidden] { display:none; }
  #pwModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:24rem; width:100%; padding:1.1rem 1.25rem 1.25rem; box-shadow:0 18px 50px rgba(0,0,0,0.35); }
  #pwModal .pairinput { text-transform:none; letter-spacing:normal; text-align:left; font-family:var(--sans); font-weight:400; }
  @media (max-width:720px) {
    #pwOverlay { align-items:flex-end; padding:0; }
    #pwModal { border-radius:16px 16px 0 0; max-width:none; padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }
  #pairOverlay, #chatOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:50;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #chatOverlay { z-index:58; }
  #pairOverlay[hidden], #chatOverlay[hidden] { display:none; }
  .agentbtns { display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:0.8rem; }
  .pairgo.alt { background:var(--accent-soft); color:var(--accent); }
  [data-theme="dark"] .pairgo.alt { color:var(--accent); }
  .chatinput { width:100%; padding:0.6rem 0.8rem; border:1px solid var(--line); border-radius:8px;
    background:var(--ground); color:var(--ink); font:0.95rem var(--sans); outline:none; margin:0.2rem 0 0.4rem; }
  .chatinput:focus { border-color:var(--accent); }
  .chatwarn { font-size:0.8rem; color:var(--ink-soft); background:var(--code-bg); border-radius:8px;
    padding:0.6rem 0.75rem; margin:0.6rem 0 0.8rem; line-height:1.45; }
  .chaturlrow { display:flex; gap:0.5rem; align-items:center; }
  .chaturl { flex:1; min-width:0; overflow-wrap:anywhere; font:0.75rem var(--mono); background:var(--code-bg);
    padding:0.5rem 0.6rem; border-radius:8px; }
  #pairModal, #chatModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:26rem; width:100%; padding:1.1rem 1.25rem 1.25rem; box-shadow:0 18px 50px rgba(0,0,0,0.3); }
  .pairinput { width:100%; padding:0.7rem 0.9rem; border:1px solid var(--line); border-radius:8px;
    background:var(--ground); color:var(--ink); font:600 1.1rem var(--mono); letter-spacing:0.25em;
    text-transform:uppercase; text-align:center; outline:none; margin:0.4rem 0 0.7rem; }
  .pairinput:focus { border-color:var(--accent); }
  .pairgo { background:var(--accent); color:#fff; border:none; border-radius:8px;
    padding:0.55rem 1.2rem; font:600 0.85rem var(--sans); cursor:pointer; }
  [data-theme="dark"] .pairgo { color:#10211C; }
  #pairModal .confirmrow, #chatModal .confirmrow { margin:0.4rem 0; }
  @media (max-width:720px) {
    #pairOverlay, #chatOverlay { align-items:flex-end; padding:0; }
    #pairModal, #chatModal { border-radius:16px 16px 0 0; max-width:none;
      padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }
  #tipsOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:50;
    display:flex; align-items:center; justify-content:center; padding:1rem; }
  #tipsOverlay[hidden] { display:none; }
  #tipsModal { background:var(--surface); border:1px solid var(--line); border-radius:14px;
    max-width:26rem; width:100%; max-height:85dvh; overflow-y:auto; padding:1.1rem 1.25rem 1.25rem;
    box-shadow:0 18px 50px rgba(0,0,0,0.3); }
  .tipshead { display:flex; align-items:center; justify-content:space-between; margin-bottom:0.4rem; }
  .tipshead strong { font-size:1.05rem; }
  .tipsintro, .tipsfoot { font-size:0.83rem; color:var(--ink-soft); line-height:1.5; margin:0.4rem 0 0.8rem; }
  .tipsfoot { margin:0.9rem 0 0; }
  .tipstable { border-collapse:collapse; width:100%; font-size:0.86rem; }
  .tipstable td { padding:0.42rem 0.4rem; border-bottom:1px solid var(--line); vertical-align:top; }
  .tipstable tr:last-child td { border-bottom:none; }
  .tipstable td:first-child { white-space:nowrap; padding-right:0.9rem; }
  .tipstable code { font:0.82em var(--mono); background:var(--code-bg); border-radius:4px; padding:0.12em 0.4em; }
  @media (max-width:720px) {
    #tipsOverlay { align-items:flex-end; padding:0; }
    #tipsModal { border-radius:16px 16px 0 0; max-width:none;
      padding-bottom:calc(1.25rem + env(safe-area-inset-bottom)); }
  }

  @media (max-width:720px) {
    /* Two-screen navigation: list OR note, never a cramped split. */
    #main { display:flex; }
    aside { width:100%; height:100dvh; border-right:none;
      padding-top:env(safe-area-inset-top); padding-bottom:env(safe-area-inset-bottom); }
    #main .pane { display:none; }
    #main.note-open aside { display:none; }
    #main.note-open .pane { display:block; height:100dvh; background:var(--ground); }
    .backbtn { display:inline-block; }
    #note { padding:0 1.1rem 6rem; }
    /* The sticky header owns the safe-area inset so its opaque background covers
       the notch — no transparent strip for content to scroll through. */
    .notehead { position:sticky; top:0; background:var(--ground); z-index:2;
      padding-top:calc(0.6rem + env(safe-area-inset-top)); }
    .notehead h1 { font-size:1.5rem; }
    /* 16px inputs stop iOS zoom-on-focus; bigger touch targets everywhere */
    #filter, .dailybox input, #phrase { font-size:16px; }
    #list a { padding:0.62rem 0.6rem; font-size:1rem; }
    .folder { padding-top:1.1rem; }
    .iconbtn { height:44px; min-width:44px; font-size:1.15rem; border-radius:9px; }
    .mbtn { padding:0.55rem 0.95rem; font-size:0.8rem; min-height:40px; border-radius:8px; }
    .menuitem { padding:0.85rem 1rem; font-size:1rem; }
    .menu { min-width:13rem; }
    .bar { padding:0.8rem 0.9rem 0.6rem; gap:0.55rem; }
    .dailybox { position:sticky; bottom:0; background:var(--surface);
      padding-bottom:calc(0.75rem + env(safe-area-inset-bottom)); }
    #cm .cm-editor { min-height:70dvh; }
    article { font-size:1.05rem; }
  }
  @media (hover:hover) { article:hover { outline:1px dashed var(--line); outline-offset:8px; border-radius:4px; } }
</style>
</head>
<body>
<div id="lock">
  <div class="wordmark">${MARK_SVG}<span class="vx">Vortex</span> <span class="nx">Notes</span></div>
  <div id="unlockView">
    <p>Enter your recovery phrase. Keys are derived in this tab — the phrase never leaves your browser, and this server only stores ciphertext.</p>
    <input id="phrase" type="password" placeholder="twelve words separated by spaces" autocomplete="off">
    <button id="unlockBtn">Unlock</button>
    <button class="linkbtn" id="showCreateBtn">New here? Create an account</button>
  </div>
  <div id="createView" hidden>
    <p><strong>This is your account.</strong> Twelve words, generated in this tab, never stored anywhere. Write them down — anyone with them can read your notes, and there is no reset if they're lost.</p>
    <div id="newPhrase" class="phrasebox"></div>
    <button class="linkbtn" id="copyPhraseBtn">copy to clipboard</button>
    <label class="confirmrow"><input type="checkbox" id="savedCheck"> I wrote my phrase down somewhere safe</label>
    <button id="createBtn" disabled>Create my notes</button>
    <button class="linkbtn" id="backToUnlockBtn">I already have a phrase</button>
  </div>
  <div id="status"></div>
</div>
<div id="main">
  <aside>
    <div class="bar">
      <div class="wordmark">${MARK_SVG}<span class="vx">Vortex</span> <span class="nx">Notes</span></div>
      <button class="iconbtn" id="newBtn" title="New note">${icon("plus")}</button>
      <button class="iconbtn" id="refreshBtn" title="Pull latest">${icon("refresh")}</button>
    </div>
    <input id="filter" placeholder="Filter notes…" autocomplete="off">
    <nav id="list"></nav>
    <div class="usermenuwrap">
      <div class="usermenu" id="userMenu" hidden>
        <div class="umsection">
          <button class="menuitem" id="nameBtn">${icon("user")}<span>Display name</span><span class="umval" id="umName"></span></button>
          <button class="menuitem" id="acctBtn">${icon("key")}<span>Recovery phrase</span></button>
          <div class="menuitem static">${icon("storage")}<span>Storage</span><span class="umval" id="umStorage">—</span></div>
        </div>
        <div class="umsection">
          <button class="menuitem" id="agentsBtn">${icon("agent")}<span>Agents &amp; devices</span></button>
          <button class="menuitem" id="adminBtn" hidden>${icon("storage")}<span>Admin stats</span></button>
        </div>
        <div class="umsection">
          <button class="menuitem" id="themeBtn">${icon("theme")}<span>Theme</span></button>
          <button class="menuitem" id="tipsBtn">${icon("help")}<span>Markdown tips</span></button>
          <button class="menuitem" id="lockAllBtn">${icon("lock")}<span>Lock all notes</span></button>
          <button class="menuitem" id="lockBtn">${icon("signout")}<span>Sign out</span></button>
        </div>
      </div>
      <button class="usertrigger" id="userBtn" aria-haspopup="true">
        <span class="avatar" id="userAvatar"></span>
        <span class="uname" id="userLabel">Account</span>
        ${icon("more", "umore")}
      </button>
    </div>
  </aside>
  <main class="pane" id="pane"><div id="note"><div class="placeholder">Select a note, or create one with the + button.</div></div></main>
</div>
<div id="acctOverlay" hidden>
  <div id="acctModal" role="dialog" aria-label="Account and recovery">
    <div class="tipshead"><strong>Account &amp; recovery</strong><button class="iconbtn" id="acctClose" aria-label="Close">${icon("x")}</button></div>
    <p class="tipsintro">Account fingerprint <code id="acctFp"></code> — this confirms which account you're signed into.</p>
    <div class="acctlabel">Account ID (public key — safe to share)</div>
    <div class="chaturlrow"><code id="acctId" class="chaturl"></code><button id="acctIdCopy" class="mbtn">Copy</button></div>
    <div class="acctphrase">
      <div class="acctlabel">Recovery phrase</div>
      <div id="phraseReveal" class="phrasebox blurred">tap to reveal</div>
      <div class="acctrow">
        <button class="linkbtn" id="acctCopy">copy</button>
        <button class="linkbtn" id="acctDownload">download .txt</button>
      </div>
    </div>
    <p class="tipsfoot">These 12 words <strong>are</strong> your account — anyone with them can read your
    notes, and there is no reset if they're lost. They are never sent to any server and never saved in
    this browser; to see them again after you close this tab, keep your own copy now.</p>
    <div id="acctNote" class="tipsfoot" hidden>Your phrase isn't held in this session. You saved it when
    you signed up — open the app fresh and it will ask for it.</div>
    <div class="acctlabel" style="margin-top:1rem">Change my 12 words</div>
    <p class="tipsfoot">Lost track of your words, or worried they leaked? Generate a fresh phrase and
    re-key this account. Your notes, devices, and agents keep working; the old words stop opening
    anything.</p>
    <button id="rotBtn" class="pairgo">${icon("key")} Generate new words</button>
    <div id="rotFlow" hidden>
      <div id="rotPhrase" class="phrasebox" style="margin-top:0.7rem"></div>
      <label class="confirmrow"><input type="checkbox" id="rotSaved"> I wrote these 12 words down — they are now the ONLY phrase for this account</label>
      <button id="rotGo" class="pairgo" disabled>${icon("check")} Re-key my account</button>
      <div id="rotStatus" class="tipsfoot"></div>
    </div>
  </div>
</div>
<div id="pairOverlay" hidden>
  <div id="pairModal" role="dialog" aria-label="Pair an agent">
    <div class="tipshead"><strong>Pair an agent</strong><button class="iconbtn" id="pairClose" aria-label="Close">${icon("x")}</button></div>
    <div id="pairStep1">
      <p class="tipsintro">On the agent's machine, run
      <code>npx vortex-notes pair</code>
      and type the 6-letter code it shows:</p>
      <input id="pairCode" class="pairinput" placeholder="e.g. KM3PXR" maxlength="6" autocomplete="off" autocapitalize="characters">
      <button id="pairLookup" class="pairgo">Look up</button>
    </div>
    <div id="pairStep2" hidden>
      <p class="tipsintro">Approve <strong id="pairName"></strong> for this space?</p>
      <label class="confirmrow"><input type="radio" name="pairMode" value="rw" checked> Read + write</label>
      <label class="confirmrow"><input type="radio" name="pairMode" value="ro"> Read-only (search &amp; read, never write)</label>
      <p class="tipsfoot">Its key: <code id="pairFp"></code> — every edit it makes will be signed with it and revocable.</p>
      <button id="pairApprove" class="pairgo">Approve</button>
    </div>
    <div id="pairStatus" class="tipsfoot"></div>
  </div>
</div>
<div id="chatOverlay" hidden>
  <div id="chatModal" role="dialog" aria-label="Connect a chat app">
    <div class="tipshead"><strong>Connect a chat app</strong><button class="iconbtn" id="chatClose" aria-label="Close">${icon("x")}</button></div>
    <div id="chatStep1">
      <p class="tipsintro">Gives Claude.ai, ChatGPT, or any app that takes an MCP <em>URL</em> its own agent key for this space.</p>
      <input id="chatName" class="chatinput" placeholder="Name, e.g. Claude.ai" maxlength="60" autocomplete="off">
      <label class="confirmrow"><input type="radio" name="chatMode" value="rw" checked> Read + write</label>
      <label class="confirmrow"><input type="radio" name="chatMode" value="ro"> Read-only</label>
      <p class="chatwarn">Different from your devices: chat apps can only reach a server, so <strong>this relay holds this agent's key and can read the notes it can access</strong> — and so does the chat app you connect. Your other devices and agents stay end-to-end encrypted. Revoke it anytime under Agents &amp; devices.</p>
      <button id="chatCreate" class="pairgo">Create connector</button>
    </div>
    <div id="chatStep2" hidden>
      <p class="tipsintro">Your connector URL — treat it like a password:</p>
      <div class="chaturlrow"><code id="chatUrl" class="chaturl"></code><button id="chatCopy" class="mbtn">Copy</button></div>
      <p class="tipsfoot"><strong>Claude</strong> (web, desktop, mobile): Settings → Connectors → Add custom connector → paste the URL.<br>
      <strong>ChatGPT</strong>: Settings → Apps &amp; Connectors → Advanced → turn on Developer mode → Create → paste the URL, authentication “No authentication”.<br>
      <strong>Others</strong>: anywhere that asks for a remote / Streamable HTTP MCP server URL.</p>
    </div>
    <div id="chatStatus" class="tipsfoot"></div>
  </div>
</div>
<div id="adminOverlay" hidden>
  <div id="adminModal" role="dialog" aria-label="Admin stats">
    <div class="tipshead"><strong>Relay stats</strong><button class="iconbtn" id="adminClose" aria-label="Close">${icon("x")}</button></div>
    <div id="adminGrid" class="admingrid"></div>
    <div class="acctlabel" style="margin-top:0.9rem">By country</div>
    <p class="tipsintro" style="margin:0.2rem 0 0.4rem">Coarse country from IP, in memory only — the address itself is never stored.</p>
    <div id="adminCountries" class="countries"></div>
    <div class="acctlabel" style="margin-top:0.9rem">Accounts</div>
    <p class="tipsintro" style="margin:0.2rem 0 0.4rem">Tag your own accounts once — anything untagged after that is a real user.</p>
    <div id="adminAccts" class="adminaccts"></div>
  </div>
</div>
<div id="histOverlay" hidden>
  <div id="histModal" role="dialog" aria-label="Note history">
    <div class="tipshead"><strong>History</strong><button class="iconbtn" id="histClose" aria-label="Close">${icon("x")}</button></div>
    <p class="tipsintro">Every saved version, newest first. Restoring never loses anything — the current version stays in history too.</p>
    <div id="histList" class="histlist"></div>
    <div id="histPreview" class="histpreview"></div>
    <button id="histRestore" class="pairgo" hidden>${icon("check")} Restore this version</button>
  </div>
</div>
<div id="agentsOverlay" hidden>
  <div id="agentsModal" role="dialog" aria-label="Agents and devices">
    <div class="tipshead"><strong>Agents &amp; devices</strong><button class="iconbtn" id="agentsClose" aria-label="Close">${icon("x")}</button></div>
    <p class="tipsintro">Everything that can reach your notes. Each device and agent has its own key — revoke any anytime; your account is unaffected.</p>
    <div id="agentsList" class="agentslist"></div>
    <div class="agentbtns">
      <button id="pairBtn" class="pairgo">${icon("plus")} Pair an agent</button>
      <button id="chatBtn" class="pairgo alt">${icon("plus")} Connect a chat app</button>
    </div>
    <div id="agentsErr" class="lockerr"></div>
  </div>
</div>
<div id="pubOverlay" hidden>
  <div id="pubModal" role="dialog" aria-label="Public link">
    <div class="tipshead"><strong id="pubTitle">Make this note public</strong><button class="iconbtn" id="pubClose" aria-label="Close">${icon("x")}</button></div>
    <p class="tipsintro">Anyone with the link can read it. A readable copy is stored on the server —
    that's what "public" means. Edits you make re-publish automatically; unpublish removes it.</p>
    <div class="acctlabel">Signed as</div>
    <label class="confirmrow"><input type="radio" name="pubAuthor" value="name" checked>
      <input id="pubName" class="pubname" placeholder="Your display name" autocomplete="off"></label>
    <label class="confirmrow"><input type="radio" name="pubAuthor" value="anon"> Anonymous</label>
    <div class="acctlabel" style="margin-top:0.8rem">Theme</div>
    <div class="themerow">
      <label class="themecard t-manuscript"><input type="radio" name="pubTheme" value="manuscript" checked><span>Manuscript</span></label>
      <label class="themecard t-vortex"><input type="radio" name="pubTheme" value="vortex"><span>Vortex</span></label>
      <label class="themecard t-typewriter"><input type="radio" name="pubTheme" value="typewriter"><span>Typewriter</span></label>
    </div>
    <div id="pubLinkRow" hidden>
      <div class="acctlabel" style="margin-top:0.8rem">Public link</div>
      <div class="publink"><a id="pubLink" target="_blank" rel="noopener"></a><button class="linkbtn" id="pubCopy">copy</button></div>
    </div>
    <div id="pubErr" class="lockerr"></div>
    <div class="acctrow" style="margin-top:0.9rem">
      <button id="pubGo" class="pairgo">Publish</button>
      <button id="pubOff" class="mbtn danger" hidden>Unpublish</button>
    </div>
  </div>
</div>
<div id="pwOverlay" hidden>
  <div id="pwModal" role="dialog" aria-label="Password">
    <div class="tipshead"><strong id="pwTitle">Password</strong><button class="iconbtn" id="pwClose" aria-label="Close">${icon("x")}</button></div>
    <p id="pwHint" class="tipsintro"></p>
    <input id="pwInput" type="password" class="pairinput" placeholder="Password" autocomplete="new-password">
    <input id="pwConfirm" type="password" class="pairinput" placeholder="Confirm password" autocomplete="new-password" hidden>
    <div id="pwErr" class="lockerr"></div>
    <button id="pwGo" class="pairgo">OK</button>
  </div>
</div>
<div id="tipsOverlay" hidden>
  <div id="tipsModal" role="dialog" aria-label="Markdown tips">
    <div class="tipshead">
      <strong>Writing basics</strong>
      <button class="iconbtn" id="tipsClose" aria-label="Close">${icon("x")}</button>
    </div>
    <p class="tipsintro">Just type — formatting appears as you write. The raw marks only show on the line you're editing.</p>
    <table class="tipstable">
      <tr><td><code># Title</code></td><td>big heading (<code>##</code>, <code>###</code> = smaller)</td></tr>
      <tr><td><code>**bold**</code></td><td><strong>bold</strong></td></tr>
      <tr><td><code>*italic*</code></td><td><em>italic</em></td></tr>
      <tr><td><code>~~done~~</code></td><td><del>struck through</del></td></tr>
      <tr><td><code>- item</code></td><td>• bulleted list</td></tr>
      <tr><td><code>1. item</code></td><td>numbered list</td></tr>
      <tr><td><code>[[Note title]]</code></td><td>link to another note</td></tr>
      <tr><td><code>&gt; quote</code></td><td>quoted text</td></tr>
      <tr><td><code>\`code\`</code></td><td>inline <code>code</code></td></tr>
      <tr><td><code>---</code></td><td>divider line</td></tr>
    </table>
    <p class="tipsfoot">Tip: the box at the bottom of the list adds a timestamped line to today's daily note — the fastest way to capture a thought.</p>
  </div>
</div>
<script src="/app/bundle.js"></script>
</body>
</html>`;
}

const MARK_SVG = `<span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
</svg></span>`;
