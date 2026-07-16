/**
 * Public note pages — served at /p/<slug>. Three immersive themes.
 * Static HTML, no scripts (and a CSP that forbids them), so published
 * content can never execute anything on our origin.
 */

export type PublicTheme = "manuscript" | "vortex" | "typewriter";

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const MARK = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
<path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12"/>
<path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12" transform="rotate(120 12 12)"/>
<path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12" transform="rotate(240 12 12)"/>
</g>
<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.5">
<path d="M12 6.75 A5.25 5.25 0 0 1 17.25 12"/>
<path d="M12 6.75 A5.25 5.25 0 0 1 17.25 12" transform="rotate(120 12 12)"/>
<path d="M12 6.75 A5.25 5.25 0 0 1 17.25 12" transform="rotate(240 12 12)"/>
</g>
<circle cx="12" cy="12" r="1.4" fill="currentColor"/>
</svg>`;

const THEMES: Record<PublicTheme, string> = {
  manuscript: `
  body { background:
      radial-gradient(ellipse 120% 80% at 50% -10%, rgba(255,240,200,0.10), transparent 60%),
      radial-gradient(ellipse 140% 100% at 50% 115%, rgba(0,0,0,0.55), transparent 55%),
      linear-gradient(165deg, #201a12, #14100a 55%, #0d0b07);
    animation: candle 9s ease-in-out infinite alternate; }
  @keyframes candle { from { background-position: 0 0, 0 0, 0 0; filter:brightness(1); }
    to { filter:brightness(1.06); } }
  .sheet { background:
      linear-gradient(174deg, #f4ead2 0%, #efe2c2 48%, #e7d7b2 100%), ${NOISE};
    background-blend-mode: normal, multiply;
    color:#2c2417; border-radius:3px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 30px 70px rgba(0,0,0,0.65),
      0 4px 14px rgba(0,0,0,0.4);
    position:relative; }
  .sheet::before { content:""; position:absolute; inset:0; border-radius:3px;
    box-shadow: inset 0 0 90px rgba(120,90,40,0.22); pointer-events:none; }
  h1.title { font-size:2.3rem; letter-spacing:0.01em; }
  .rule { border:none; height:1px; margin:1.4rem auto 2rem; width:38%;
    background:linear-gradient(90deg, transparent, #8a6f3f, transparent); }
  article > p:first-of-type::first-letter {
    font-size:3.4em; line-height:0.85; float:left; padding:0.08em 0.12em 0 0;
    color:#7a5b23; font-family:"Iowan Old Style","Charter",Georgia,serif; }
  a { color:#7a5b23; } article code { background:rgba(120,90,40,0.12); }
  blockquote { border-left:2px solid #b9a06a; color:#584a30; }
  .byline, .foot { color:#6d5c3c; }
  .foot a { color:#7a5b23; }`,

  vortex: `
  body { background: radial-gradient(ellipse 90% 70% at 50% 0%, #12211c, transparent 70%),
      #090f0d; color:#DFE9E4; }
  body::before { content:""; position:fixed; inset:-20vmax; opacity:0.07; color:#4CC2A0;
    background: radial-gradient(circle at 50% 50%, rgba(76,194,160,0.5), transparent 60%);
    animation: breathe 12s ease-in-out infinite alternate; pointer-events:none; }
  @keyframes breathe { from { transform:scale(0.9); opacity:0.05; } to { transform:scale(1.05); opacity:0.10; } }
  .watermark { position:fixed; top:50%; left:50%; width:min(120vmin,900px); height:min(120vmin,900px);
    transform:translate(-50%,-50%); color:#4CC2A0; opacity:0.05; pointer-events:none; }
  .watermark svg { width:100%; height:100%; animation:spin 90s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .sheet { background:rgba(14,21,19,0.72); backdrop-filter: blur(6px); color:#DFE9E4;
    border:1px solid rgba(76,194,160,0.18); border-radius:16px;
    box-shadow:0 30px 80px rgba(0,0,0,0.6); }
  h1.title { color:#EAF4EF; text-shadow:0 0 28px rgba(76,194,160,0.35); }
  .rule { border:none; height:1px; margin:1.4rem auto 2rem; width:44%;
    background:linear-gradient(90deg, transparent, rgba(76,194,160,0.7), transparent); }
  h2,h3 { color:#8fd8c0; } a { color:#4CC2A0; }
  article code { background:rgba(76,194,160,0.12); color:#c9e5db; }
  blockquote { border-left:2px solid rgba(76,194,160,0.5); color:#a9bcb4; }
  .byline, .foot { color:#7d918a; } .foot a { color:#4CC2A0; }`,

  typewriter: `
  body { background: linear-gradient(180deg, #efece3, #e7e3d7); color:#26231d; }
  .page-wrap, .sheet, article, h1.title { font-family:"American Typewriter", ui-monospace, "Courier New", monospace; }
  .sheet { background: linear-gradient(180deg, #fbfaf5, #f5f2e9), ${NOISE};
    background-blend-mode: normal, multiply;
    color:#26231d; border-radius:2px;
    box-shadow: 0 24px 60px rgba(40,35,20,0.35); position:relative; }
  .sheet::after { content:""; position:absolute; left:3.2rem; top:0; bottom:0; width:1px;
    background:rgba(179,56,44,0.35); }
  h1.title { font-size:1.7rem; text-transform:uppercase; letter-spacing:0.12em; }
  .rule { border:none; border-top:2px solid #b3382c; width:5rem; margin:1.2rem auto 2rem; }
  h2,h3 { text-transform:uppercase; letter-spacing:0.08em; font-size:1.02em; }
  a { color:#b3382c; } article code { background:rgba(38,35,29,0.08); }
  blockquote { border-left:2px solid #b3382c; color:#4c463a; }
  .byline, .foot { color:#7b7466; } .foot a { color:#b3382c; }`,
};

export function renderPublicPage(opts: {
  title: string;
  author: string | null;
  theme: PublicTheme;
  bodyHtml: string;
  updatedAt: string;
}): string {
  const theme = THEMES[opts.theme] ?? THEMES.manuscript;
  const date = new Date(opts.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const by = opts.author ? escapeHtml(opts.author) : "Anonymous";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<meta property="og:title" content="${escapeHtml(opts.title)}">
<meta property="og:description" content="A note by ${by} — written in Vortex Notes">
<link rel="icon" href="data:image/svg+xml,%3Csvg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cg stroke='%2314735C' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12'/%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12' transform='rotate(120 12 12)'/%3E%3Cpath d='M12 2.75 A9.25 9.25 0 0 1 21.25 12' transform='rotate(240 12 12)'/%3E%3C/g%3E%3Ccircle cx='12' cy='12' r='2.2' fill='%2314735C'/%3E%3C/svg%3E">
<style>
  * { box-sizing:border-box; }
  html, body { margin:0; min-height:100%; }
  body { font:18px/1.72 "Charter","Iowan Old Style",Georgia,serif; }
  .page-wrap { max-width:47rem; margin:0 auto; padding:clamp(1rem,4vw,3.5rem) 1rem 4rem; }
  .sheet { padding:clamp(2rem,6vw,4.5rem) clamp(1.4rem,6vw,4.5rem) clamp(2.5rem,6vw,4rem); }
  h1.title { font-family:"Charter","Iowan Old Style",Georgia,serif; line-height:1.15;
    text-align:center; margin:0 0 0.4rem; text-wrap:balance; }
  .byline { text-align:center; font-size:0.85rem; letter-spacing:0.14em; text-transform:uppercase; }
  article { font-size:1.02em; }
  article h1, article h2, article h3 { line-height:1.25; margin:1.8em 0 0.5em; }
  article p { margin:0 0 1.05em; }
  article img { max-width:100%; border-radius:4px; }
  article pre { overflow-x:auto; padding:1rem 1.2rem; border-radius:8px; background:rgba(0,0,0,0.25); font-size:0.78em; }
  article code { font-family:ui-monospace,Menlo,monospace; font-size:0.86em; border-radius:4px; padding:0.08em 0.35em; }
  article blockquote { margin:1.2em 0; padding:0.1em 1.3em; font-style:italic; }
  article ul, article ol { padding-left:1.5rem; }
  article hr { border:none; text-align:center; margin:2.2em 0; }
  article hr::after { content:"⁂"; opacity:0.55; }
  .foot { margin-top:3.5rem; padding-top:1.4rem; text-align:center; font-size:0.78rem;
    font-family:-apple-system,sans-serif; letter-spacing:0.03em; }
  .foot .mk { display:inline-block; width:15px; height:15px; vertical-align:-3px; margin-right:0.35rem; }
  .foot a { text-decoration:none; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation:none !important; } }
  ${theme}
</style>
</head>
<body>
${opts.theme === "vortex" ? `<div class="watermark" aria-hidden="true">${MARK}</div>` : ""}
<div class="page-wrap">
  <div class="sheet">
    <h1 class="title">${escapeHtml(opts.title)}</h1>
    <div class="byline">${by} · ${escapeHtml(date)}</div>
    <hr class="rule">
    <article>${opts.bodyHtml}</article>
    <div class="foot"><span class="mk">${MARK}</span>Written in <a href="/">Vortex Notes</a> — your notes, your agents' memory, one encrypted place</div>
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
