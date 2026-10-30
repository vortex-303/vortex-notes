/**
 * /privacy and /terms: plain pages that describe what this relay actually
 * stores. Directory listings (Claude, ChatGPT) link here, so keep them true to
 * the code: core.ts (schema), geo.ts (country only), oauth.ts, hostedmcp.ts.
 */
import { FAVICON_HREF } from "./brand.js";

const UPDATED = "2026-10-29";
const ISSUES = "https://github.com/vortex-303/vortex-notes/issues";

const HOSTED = "https://vortex-notes.pages.dev";

/** On someone else's server these pages are the hosted service's policy, not the operator's: say so. */
function selfHostNote(origin: string): string {
  if (origin === HOSTED) return "";
  return `<p style="border-left:3px solid var(--accent);padding:0.4rem 0.8rem;color:var(--ink-soft)">This server (${origin.replace(/</g, "&lt;")})
is run by its own operator, not by Vortex Notes. The text below is the policy of the hosted service at
<a href="${HOSTED}">vortex-notes.pages.dev</a>, shown as a template; ask this server's operator for theirs.</p>`;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Vortex Notes</title>
<link rel="icon" href="${FAVICON_HREF}">
<style>
  :root { --ground:#F8FAF8; --ink:#1D2421; --ink-soft:#4A554F; --line:#DFE6E1; --accent:#14735C;
    --serif:"Charter","Iowan Old Style",Georgia,serif; --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  @media (prefers-color-scheme: dark) { :root { --ground:#121715; --ink:#E6ECE8; --ink-soft:#ACB8B1; --line:#2C3531; --accent:#4CC2A0; } }
  body { margin:0; background:var(--ground); color:var(--ink); font:16px/1.65 var(--sans); }
  main { max-width:42rem; margin:0 auto; padding:2.5rem 1.25rem 4rem; }
  a { color:var(--accent); }
  h1 { font:700 2rem/1.2 var(--serif); margin:1.2rem 0 0.3rem; }
  h2 { font:700 1.15rem var(--sans); margin:2rem 0 0.4rem; }
  .meta { color:var(--ink-soft); font-size:0.9rem; }
  li { margin:0.25rem 0; }
  nav { font-size:0.9rem; }
  footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--ink-soft); font-size:0.85rem; }
</style>
</head>
<body><main>
<nav><a href="/">← Vortex Notes</a></nav>
<h1>${title}</h1>
<p class="meta">Last updated ${UPDATED}</p>
${body}
<footer><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="${ISSUES}">Support</a> ·
Vortex Notes is open source (MIT): <a href="https://github.com/vortex-303/vortex-notes">github.com/vortex-303/vortex-notes</a></footer>
</main></body>
</html>`;
}

export function privacyPage(origin = HOSTED): string {
  return page(
    "Privacy policy",
    selfHostNote(origin) + `<p>Vortex Notes is a notes app for you and your AI agents. This policy covers the hosted service at
this address. If you run your own server (<code>vortex-notes relay</code>), this policy doesn't apply to it.</p>

<h2>The short version</h2>
<ul>
  <li>Your notes are end-to-end encrypted. The keys come from your 12-word recovery phrase on your own devices; this server never has them and can't read your notes.</li>
  <li>The one exception is a <strong>chat connector</strong> you create for Claude, ChatGPT or another chat app: for those, the server holds that connector's key so it can answer the app's requests, and can read the notes that connector may access.</li>
  <li>No ads, no analytics, no tracking cookies, and we don't sell or share your data.</li>
</ul>

<h2>What we store</h2>
<ul>
  <li><strong>Account and devices:</strong> public keys for your account, each device and each agent, their certificates, names you gave them, and when they were created.</li>
  <li><strong>Notes:</strong> encrypted changes we can't open, with their size, time, and which device or agent sent each one.</li>
  <li><strong>Country:</strong> a two-letter country code per device, worked out in memory from the connection. The IP address itself isn't stored or logged by the app.</li>
  <li><strong>Public notes:</strong> if you choose to publish a note, its text is stored readable so anyone with the link can see it. Unpublish to remove it.</li>
  <li><strong>Chat connectors:</strong> the connector's private key, encrypted with a server key, plus when it was created and last used.</li>
  <li><strong>Chat app sign-ins (OAuth):</strong> the app's name and return addresses, and sign-in tokens, stored only as one-way hashes.</li>
</ul>

<h2>How chat connectors use your notes</h2>
<p>When a chat app you connected calls a tool (search, read, write), the server unlocks only the notes that
connector may access, in memory, to answer that request, and sends the result to that app. What the app does
with it is covered by the app's own privacy policy (for example Anthropic's for Claude, OpenAI's for ChatGPT).
Read-only connectors can't change anything. Revoking a connector in <em>Agents &amp; devices</em> deletes its key
and sign-in tokens immediately.</p>

<h2>Who else processes data</h2>
<p>The service runs on Cloudflare, which carries the encrypted traffic and stores the database. Cloudflare
may process connection details such as IP addresses to operate and protect its network. We use no other
third-party services.</p>

<h2>How long we keep it</h2>
<p>Encrypted notes and account records stay until you delete them or ask us to delete your account.
Sign-in requests and codes expire within minutes, access tokens after an hour, and refresh tokens after 30 days
unless used. To delete your account and everything stored for it, open a request at
<a href="${ISSUES}">our support page</a> with your Account ID (shown under Account &amp; recovery); please don't
post your 12 words. We delete it within 30 days.</p>

<h2>Your 12 words</h2>
<p>Your recovery phrase is your account. We never ask for it, and nobody from Vortex Notes will. Because we don't
have it, we can't reset it or recover notes without it.</p>

<h2>Children</h2>
<p>The service isn't directed at children under 13.</p>

<h2>Changes and contact</h2>
<p>We'll update this page and its date when practices change. Questions: <a href="${ISSUES}">${ISSUES.replace("https://", "")}</a>.</p>`
  );
}

export function termsPage(origin = HOSTED): string {
  return page(
    "Terms of use",
    selfHostNote(origin) + `<p>These terms cover the hosted Vortex Notes service at this address. The software itself is open source
under the MIT license; you can run your own server instead.</p>

<h2>Using the service</h2>
<ul>
  <li>The service is free and provided as is, without warranties. It may change, have downtime, or set storage limits (currently 50MB of encrypted notes per account).</li>
  <li>You're responsible for your 12-word recovery phrase. Without it your notes can't be recovered, by you or by us.</li>
  <li>You're responsible for the agents and chat apps you connect and the access you give them. You can revoke any of them at any time.</li>
  <li>Don't use the service to break the law, to store or publish content you don't have the right to, or to attack or overload it.</li>
</ul>

<h2>Your content</h2>
<p>Your notes are yours. We don't claim any rights to them. Notes you publish are visible to anyone with the link
until you unpublish them.</p>

<h2>Ending use</h2>
<p>You can stop using the service at any time and ask us to delete your account (see the <a href="/privacy">privacy policy</a>).
We may suspend accounts that break these terms.</p>

<h2>Liability</h2>
<p>To the extent the law allows, we aren't liable for lost data or indirect damages from using the service. Keep
copies of anything important: the command-line tool keeps a plain markdown copy of your notes on your computer.</p>

<h2>Contact</h2>
<p><a href="${ISSUES}">${ISSUES.replace("https://", "")}</a></p>`
  );
}
