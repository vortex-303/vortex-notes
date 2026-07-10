/**
 * The local web viewer: a single self-contained page. Client JS avoids
 * template literals so this file's template literal stays unambiguous.
 */
export function htmlShell(nonce: string, vaultRoot: string): string {
  const vaultName = vaultRoot.split("/").pop() ?? "vault";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(vaultName)} — Vortex Notes</title>
<style>
  :root {
    --ground: #F8FAF8; --surface: #FFFFFF; --ink: #1D2421; --ink-soft: #4A554F;
    --ink-faint: #75817A; --line: #DFE6E1; --accent: #14735C; --accent-soft: #E3F0EB;
    --code-bg: #F0F4F1;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --serif: "Charter", "Iowan Old Style", Georgia, serif;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  [data-theme="dark"] {
    --ground: #121715; --surface: #1A211E; --ink: #E6ECE8; --ink-soft: #ACB8B1;
    --ink-faint: #7D8A83; --line: #2C3531; --accent: #4CC2A0; --accent-soft: #1C2F29;
    --code-bg: #202824;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { display: flex; background: var(--ground); color: var(--ink); font-family: var(--sans); }

  aside {
    width: 290px; flex: none; height: 100vh; overflow-y: auto;
    background: var(--surface); border-right: 1px solid var(--line);
    display: flex; flex-direction: column;
  }
  .brand {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1rem 1rem 0.75rem;
  }
  .brand h1 { font: 700 0.95rem var(--sans); margin: 0; letter-spacing: -0.01em; }
  .brand h1 .vx { color: var(--accent); }
  .brand button {
    background: none; border: 1px solid var(--line); border-radius: 6px; color: var(--ink-soft);
    width: 28px; height: 28px; cursor: pointer; font-size: 0.9rem; line-height: 1;
  }
  .brand button:hover { border-color: var(--accent); color: var(--accent); }
  .searchbox { padding: 0 1rem 0.75rem; }
  .searchbox input {
    width: 100%; padding: 0.5rem 0.7rem; border: 1px solid var(--line); border-radius: 7px;
    background: var(--ground); color: var(--ink); font: 0.85rem var(--sans); outline: none;
  }
  .searchbox input:focus { border-color: var(--accent); }
  nav { flex: 1; padding: 0 0.5rem 1rem; }
  .folder {
    font: 600 0.62rem var(--mono); letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--ink-faint); padding: 0.9rem 0.5rem 0.3rem;
  }
  nav a {
    display: block; padding: 0.32rem 0.5rem; border-radius: 6px; text-decoration: none;
    color: var(--ink-soft); font-size: 0.86rem; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis;
  }
  nav a:hover { background: var(--accent-soft); color: var(--ink); }
  nav a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .hit .snip { font-size: 0.74rem; color: var(--ink-faint); white-space: normal; margin-top: 2px; }
  .hit { margin-bottom: 0.35rem; }
  .empty-msg { color: var(--ink-faint); font-size: 0.82rem; padding: 0.5rem; }

  main { flex: 1; height: 100vh; overflow-y: auto; }
  .page { max-width: 46rem; margin: 0 auto; padding: 3rem 2.2rem 6rem; }
  .placeholder { color: var(--ink-faint); font: 1rem var(--serif); font-style: italic; margin-top: 30vh; text-align: center; }

  .notehead { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 1.6rem; }
  .notehead .meta { font: 0.7rem var(--mono); color: var(--ink-faint); letter-spacing: 0.05em; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  .notehead .tag { background: var(--accent-soft); color: var(--accent); padding: 0.1rem 0.5rem; border-radius: 999px; }
  .notehead h1 { font: 700 2rem/1.15 var(--serif); letter-spacing: -0.015em; margin: 0.4rem 0 0.6rem; }
  .notehead button {
    margin-left: auto; background: none; border: 1px solid var(--line); border-radius: 6px;
    color: var(--ink-soft); font: 0.68rem var(--mono); padding: 0.2rem 0.55rem; cursor: pointer;
  }
  .notehead button:hover { border-color: var(--accent); color: var(--accent); }

  article { font: 1.02rem/1.68 var(--serif); }
  article h1, article h2, article h3, article h4 { font-family: var(--serif); letter-spacing: -0.01em; line-height: 1.25; margin: 1.8em 0 0.5em; }
  article h1 { font-size: 1.55rem; } article h2 { font-size: 1.3rem; } article h3 { font-size: 1.1rem; }
  article p { margin: 0 0 1em; }
  article a { color: var(--accent); }
  article .wikilink { text-decoration: none; border-bottom: 1px solid var(--accent); }
  article .wikilink.broken { color: var(--ink-faint); border-bottom: 1px dashed var(--ink-faint); cursor: default; }
  article code { font: 0.85em var(--mono); background: var(--code-bg); border-radius: 4px; padding: 0.1em 0.35em; }
  article pre { background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.2rem; overflow-x: auto; }
  article pre code { background: none; padding: 0; }
  article blockquote { margin: 1em 0; padding: 0.1em 1.2em; border-left: 3px solid var(--accent); color: var(--ink-soft); }
  article img { max-width: 100%; border-radius: 6px; }
  article hr { border: none; border-top: 1px solid var(--line); margin: 2em 0; }
  article table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
  article th, article td { border: 1px solid var(--line); padding: 0.45rem 0.7rem; text-align: left; }
  article th { background: var(--code-bg); font-family: var(--sans); font-size: 0.8rem; }
  article ul, article ol { padding-left: 1.5rem; }
  article li { margin-bottom: 0.3em; }
  article del { color: var(--ink-faint); }
  article input[type=checkbox] { accent-color: var(--accent); }
  pre.rawview { font: 0.82rem/1.6 var(--mono); white-space: pre-wrap; word-break: break-word; }

  @media (max-width: 720px) {
    body { flex-direction: column; }
    aside { width: 100%; height: auto; max-height: 45vh; border-right: none; border-bottom: 1px solid var(--line); }
    main { height: auto; }
    .page { padding: 1.5rem 1.2rem 4rem; }
  }
</style>
</head>
<body>
<aside>
  <div class="brand">
    <h1><span class="vx">Vortex</span> Notes</h1>
    <button id="themeBtn" title="Toggle theme">◐</button>
  </div>
  <div class="searchbox"><input id="search" type="search" placeholder="Search notes…" autocomplete="off"></div>
  <nav id="nav"></nav>
</aside>
<main><div class="page" id="page"><div class="placeholder">Select a note — or search.</div></div></main>

<script nonce="${nonce}">
(function () {
  "use strict";
  var notes = [];
  var current = null;
  var rawMode = false;

  // Theme
  var root = document.documentElement;
  var saved = localStorage.getItem("vn-theme");
  var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.setAttribute("data-theme", saved || (prefersDark ? "dark" : "light"));
  document.getElementById("themeBtn").addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("vn-theme", next);
  });

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function noteLink(path, label, cls) {
    return '<a class="' + (cls || "") + '" data-path="' + esc(path) + '" href="#/note/' + encodeURIComponent(path) + '">' + esc(label) + "</a>";
  }

  function renderList() {
    var groups = {};
    notes.forEach(function (n) {
      var folder = n.path.indexOf("/") >= 0 ? n.path.slice(0, n.path.lastIndexOf("/")) : "";
      (groups[folder] = groups[folder] || []).push(n);
    });
    var html = "";
    Object.keys(groups).sort().forEach(function (folder) {
      html += '<div class="folder">' + esc(folder || "· root") + "</div>";
      groups[folder].forEach(function (n) {
        html += noteLink(n.path, n.title, current === n.path ? "active" : "");
      });
    });
    document.getElementById("nav").innerHTML = html || '<div class="empty-msg">No notes yet.</div>';
  }

  function renderSearch(results, q) {
    var html = '<div class="folder">Results for \\u201C' + esc(q) + '\\u201D</div>';
    if (!results.length) html += '<div class="empty-msg">Nothing found.</div>';
    results.forEach(function (r) {
      html += '<div class="hit">' + noteLink(r.path, r.title + (r.heading ? " › " + r.heading : ""), current === r.path ? "active" : "");
      html += '<div class="snip">' + esc(r.snippet.slice(0, 140)) + "</div></div>";
    });
    document.getElementById("nav").innerHTML = html;
  }

  function openNote(path) {
    fetch("/api/note?path=" + encodeURIComponent(path))
      .then(function (r) { if (!r.ok) throw new Error("not found"); return r.json(); })
      .then(function (n) {
        current = path;
        var meta = '<div class="meta"><span>' + esc(n.path) + "</span>";
        (n.tags || []).forEach(function (t) { meta += '<span class="tag">' + esc(t) + "</span>"; });
        if (n.updated) meta += "<span>" + esc(String(n.updated).slice(0, 10)) + "</span>";
        meta += '<button id="rawBtn">' + (rawMode ? "rendered" : "source") + "</button></div>";
        var content = rawMode
          ? '<pre class="rawview">' + esc(n.body) + "</pre>"
          : "<article>" + n.html + "</article>";
        document.getElementById("page").innerHTML =
          '<div class="notehead">' + meta + "<h1>" + esc(n.title) + "</h1></div>" + content;
        document.getElementById("rawBtn").addEventListener("click", function () {
          rawMode = !rawMode;
          openNote(path);
        });
        document.title = n.title + " — Vortex Notes";
        renderList();
        document.querySelector("main").scrollTop = 0;
      })
      .catch(function () {
        document.getElementById("page").innerHTML = '<div class="placeholder">Note not found.</div>';
      });
  }

  function route() {
    var m = location.hash.match(/^#\\/note\\/(.+)$/);
    if (m) openNote(decodeURIComponent(m[1]));
  }
  window.addEventListener("hashchange", route);

  function loadList(then) {
    fetch("/api/notes").then(function (r) { return r.json(); }).then(function (data) {
      notes = data;
      renderList();
      if (then) then();
    });
  }

  var searchTimer = null;
  document.getElementById("search").addEventListener("input", function (e) {
    var q = e.target.value.trim();
    clearTimeout(searchTimer);
    if (!q) { renderList(); return; }
    searchTimer = setTimeout(function () {
      fetch("/api/search?q=" + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (results) { renderSearch(results, q); });
    }, 250);
  });

  try {
    var es = new EventSource("/api/events");
    es.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.type !== "change") return;
      loadList(function () {
        if (current === msg.path && !rawMode) openNote(current);
      });
    };
  } catch (e) { /* SSE unsupported — manual refresh still works */ }

  loadList(route);
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
