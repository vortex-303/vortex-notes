/**
 * The local web app: a single self-contained page. Client JS avoids
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
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke="#14735C" stroke-width="2.4" stroke-linecap="round"><path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12"/><path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12" transform="rotate(120 12 12)"/><path d="M12 2.75 A9.25 9.25 0 0 1 21.25 12" transform="rotate(240 12 12)"/></g><circle cx="12" cy="12" r="2.2" fill="#14735C"/></svg>`
  )}">
<style>
  :root {
    --ground: #F8FAF8; --surface: #FFFFFF; --ink: #1D2421; --ink-soft: #4A554F;
    --ink-faint: #75817A; --line: #DFE6E1; --accent: #14735C; --accent-soft: #E3F0EB;
    --danger: #A33B2E; --code-bg: #F0F4F1;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --serif: "Charter", "Iowan Old Style", Georgia, serif;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  [data-theme="dark"] {
    --ground: #121715; --surface: #1A211E; --ink: #E6ECE8; --ink-soft: #ACB8B1;
    --ink-faint: #7D8A83; --line: #2C3531; --accent: #4CC2A0; --accent-soft: #1C2F29;
    --danger: #E08573; --code-bg: #202824;
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
    display: flex; align-items: center; gap: 0.55rem;
    padding: 1rem 1rem 0.75rem;
  }
  .brand h1 { font: 400 0.95rem var(--sans); margin: 0 auto 0 0; letter-spacing: 0.01em; display: flex; align-items: center; gap: 0.55rem; }
  .brand h1 .vx { color: var(--accent); font-weight: 600; letter-spacing: -0.005em; }
  .brand h1 .nx { color: var(--ink-soft); font-weight: 400; margin-left: -0.25rem; }
  .mark { color: var(--accent); display: inline-flex; }
  .mark svg { width: 21px; height: 21px; display: block; }
  .mark .outer, .mark .inner { transform-origin: 12px 12px; }
  .mark .outer { animation: vspin 14s linear infinite; }
  .mark .inner { animation: vspin-rev 9s linear infinite; }
  @keyframes vspin { to { transform: rotate(360deg); } }
  @keyframes vspin-rev { to { transform: rotate(-360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .mark .outer, .mark .inner { animation: none; }
  }
  .iconbtn {
    background: none; border: 1px solid var(--line); border-radius: 6px; color: var(--ink-soft);
    min-width: 28px; height: 28px; cursor: pointer; font-size: 0.9rem; line-height: 1; padding: 0 0.4rem;
  }
  .iconbtn:hover { border-color: var(--accent); color: var(--accent); }
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
  .dailybox { padding: 0.75rem 1rem; border-top: 1px solid var(--line); }
  .dailybox input {
    width: 100%; padding: 0.45rem 0.65rem; border: 1px solid var(--line); border-radius: 7px;
    background: var(--ground); color: var(--ink); font: 0.8rem var(--sans); outline: none;
  }
  .dailybox input:focus { border-color: var(--accent); }
  .dailybox label { display: block; font: 600 0.6rem var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-faint); margin-bottom: 0.35rem; }

  main { flex: 1; height: 100vh; overflow-y: auto; }
  .page { max-width: 46rem; margin: 0 auto; padding: 3rem 2.2rem 6rem; }
  .placeholder { color: var(--ink-faint); font: 1rem var(--serif); font-style: italic; margin-top: 30vh; text-align: center; }

  .notehead { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 1.6rem; }
  .notehead .meta { font: 0.7rem var(--mono); color: var(--ink-faint); letter-spacing: 0.05em; display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
  .notehead .meta .path { margin-right: auto; }
  .notehead .tag { background: var(--accent-soft); color: var(--accent); padding: 0.1rem 0.5rem; border-radius: 999px; }
  .notehead h1 { font: 700 2rem/1.15 var(--serif); letter-spacing: -0.015em; margin: 0.4rem 0 0.6rem; }
  .mbtn {
    background: none; border: 1px solid var(--line); border-radius: 6px;
    color: var(--ink-soft); font: 0.68rem var(--mono); padding: 0.2rem 0.55rem; cursor: pointer;
  }
  .mbtn:hover { border-color: var(--accent); color: var(--accent); }
  .mbtn.danger:hover { border-color: var(--danger); color: var(--danger); }
  .mbtn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  [data-theme="dark"] .mbtn.primary { color: #10211C; }

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

  .editor {
    width: 100%; min-height: 60vh; resize: vertical;
    font: 0.9rem/1.65 var(--mono); color: var(--ink);
    background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
    padding: 1.1rem 1.3rem; outline: none;
  }
  .editor:focus { border-color: var(--accent); }
  .editnote { font: 0.72rem var(--mono); color: var(--ink-faint); margin-top: 0.5rem; }

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
    <h1><span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
    </svg></span><span class="vx">Vortex</span> <span class="nx">Notes</span></h1>
    <button class="iconbtn" id="newBtn" title="New note">＋</button>
    <button class="iconbtn" id="themeBtn" title="Toggle theme">◐</button>
  </div>
  <div class="searchbox"><input id="search" type="search" placeholder="Search notes…" autocomplete="off"></div>
  <nav id="nav"></nav>
  <div class="dailybox">
    <label for="daily">Daily note — press Enter</label>
    <input id="daily" placeholder="Quick thought…" autocomplete="off">
  </div>
</aside>
<main><div class="page" id="page"><div class="placeholder">Select a note, search, or create one with ＋</div></div></main>

<script nonce="${nonce}">
(function () {
  "use strict";
  var notes = [];
  var current = null;
  var rawMode = false;
  var editing = false;
  var pendingChange = null;

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
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? "{}" : JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
        return d;
      });
    });
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
    document.getElementById("nav").innerHTML = html || '<div class="empty-msg">No notes yet — create one with ＋</div>';
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

  function metaBar(n, buttons) {
    var meta = '<div class="meta"><span class="path">' + esc(n.path) + "</span>";
    (n.tags || []).forEach(function (t) { meta += '<span class="tag">' + esc(t) + "</span>"; });
    if (n.updated) meta += "<span>" + esc(String(n.updated).slice(0, 10)) + "</span>";
    meta += buttons + "</div>";
    return meta;
  }

  function showNote(n) {
    editing = false;
    var buttons =
      '<button class="mbtn" id="editBtn">edit</button>' +
      '<button class="mbtn" id="rawBtn">' + (rawMode ? "rendered" : "source") + "</button>" +
      '<button class="mbtn danger" id="delBtn">delete</button>';
    var content = rawMode
      ? '<pre class="rawview">' + esc(n.body) + "</pre>"
      : "<article>" + n.html + "</article>";
    document.getElementById("page").innerHTML =
      '<div class="notehead">' + metaBar(n, buttons) + "<h1>" + esc(n.title) + "</h1></div>" + content;
    document.title = n.title + " — Vortex Notes";
    document.getElementById("rawBtn").addEventListener("click", function () {
      rawMode = !rawMode; showNote(n);
    });
    document.getElementById("editBtn").addEventListener("click", function () { showEditor(n); });
    document.getElementById("delBtn").addEventListener("click", function () {
      if (!confirm("Delete " + n.path + "? The file is removed from disk.")) return;
      api("DELETE", "/api/note?path=" + encodeURIComponent(n.path)).then(function () {
        current = null;
        document.getElementById("page").innerHTML = '<div class="placeholder">Deleted.</div>';
        location.hash = "";
        loadList();
      }).catch(alertErr);
    });
    renderList();
  }

  function showEditor(n) {
    editing = true;
    var buttons =
      '<button class="mbtn primary" id="saveBtn">save</button>' +
      '<button class="mbtn" id="cancelBtn">cancel</button>';
    document.getElementById("page").innerHTML =
      '<div class="notehead">' + metaBar(n, buttons) + "<h1>" + esc(n.title) + "</h1></div>" +
      '<textarea class="editor" id="editor" spellcheck="false"></textarea>' +
      '<div class="editnote">markdown body — frontmatter is preserved automatically · \\u2318S / Ctrl+S to save</div>';
    var ta = document.getElementById("editor");
    ta.value = n.body;
    ta.focus();
    function save() {
      api("PUT", "/api/note?path=" + encodeURIComponent(n.path), { body: ta.value })
        .then(function (fresh) { pendingChange = null; showNote(fresh); })
        .catch(alertErr);
    }
    document.getElementById("saveBtn").addEventListener("click", save);
    document.getElementById("cancelBtn").addEventListener("click", function () { openNote(n.path); });
    ta.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
    });
  }

  function openNote(path, thenEdit) {
    fetch("/api/note?path=" + encodeURIComponent(path))
      .then(function (r) { if (!r.ok) throw new Error("not found"); return r.json(); })
      .then(function (n) {
        current = path;
        if (thenEdit) showEditor(n); else showNote(n);
        renderList();
        document.querySelector("main").scrollTop = 0;
      })
      .catch(function () {
        document.getElementById("page").innerHTML = '<div class="placeholder">Note not found.</div>';
      });
  }

  function alertErr(e) { alert(e.message || e); }

  document.getElementById("newBtn").addEventListener("click", function () {
    var title = prompt("Note title (prefix with folder/ to file it, e.g. projects/My Idea):");
    if (!title) return;
    var folder = "";
    var slash = title.lastIndexOf("/");
    if (slash > 0) { folder = title.slice(0, slash); title = title.slice(slash + 1); }
    api("POST", "/api/note", { title: title.trim(), folder: folder, content: "" })
      .then(function (d) {
        loadList(function () { location.hash = "#/note/" + encodeURIComponent(d.path); openNote(d.path, true); });
      })
      .catch(alertErr);
  });

  document.getElementById("daily").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var val = e.target.value.trim();
    if (!val) return;
    api("POST", "/api/daily", { content: val }).then(function (d) {
      e.target.value = "";
      loadList(function () { if (current === d.path) openNote(d.path); });
    }).catch(alertErr);
  });

  function route() {
    var m = location.hash.match(/^#\\/note\\/(.+)$/);
    if (m) openNote(decodeURIComponent(m[1]));
  }
  window.addEventListener("hashchange", function () { if (!editing) route(); });

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
      if (editing && msg.path === current) { pendingChange = msg.path; return; } // never clobber the editor
      loadList(function () {
        if (current === msg.path && !rawMode && !editing) openNote(current);
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
