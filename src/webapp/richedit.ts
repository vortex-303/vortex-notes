/**
 * Rich editor: notes open fully rendered and you type into the formatted text,
 * like Apple Notes. The file stays markdown: Tiptap parses it on open and
 * serializes it on save, with GFM tasks/tables and [[wikilinks]] kept as-is.
 *
 * Fidelity rules (agents and Obsidian read these files):
 * - an untouched note is never re-serialized: getMarkdown() returns the
 *   original body byte for byte until the markdown actually changes;
 * - on open, a note whose round trip would change what it renders to (raw
 *   HTML, footnotes, …) is refused, and the caller opens it as markdown.
 */
import { Editor, Node, Extension, nodeInputRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extensions";
import { marked } from "marked";
import type { EditorHooks, FormatKind, NoteEditor } from "./editor.js";

const WIKILINK = /^\[\[([^\][\n]+?)\]\]/;

/** [[Title]] / [[Title|alias]]: an inline atom that round-trips verbatim. */
const Wikilink = Node.create({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { target: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "a[data-wikilink]", getAttrs: (el) => ({ target: (el as HTMLElement).getAttribute("data-wikilink") ?? "" }) }];
  },
  renderHTML({ node }) {
    const target = String(node.attrs.target);
    return ["a", { "data-wikilink": target, class: "wikilink", href: "#" }, target.split("|").pop() ?? target];
  },
  markdownTokenName: "wikilink",
  markdownTokenizer: {
    name: "wikilink",
    level: "inline",
    start: (src: string) => src.indexOf("[["),
    tokenize: (src: string) => {
      const m = WIKILINK.exec(src);
      if (m) return { type: "wikilink", raw: m[0], target: m[1] } as never;
    },
  },
  parseMarkdown: (token) => ({ type: "wikilink", attrs: { target: (token as { target?: string }).target ?? "" } }),
  renderMarkdown: (node) => `[[${node.attrs?.target ?? ""}]]`,
  addInputRules() {
    return [nodeInputRule({ find: /\[\[([^\][\n]+)\]\]$/, type: this.type, getAttributes: (m) => ({ target: m[1] }) })];
  },
});

/** Links whose text is their own address go back to the file as the bare URL, as they came. */
const BareLink = Link.extend({
  // Marks are serialized around a placeholder; the real link text arrives as ctx.meta.markText.
  renderMarkdown(node, h, ctx) {
    const href = String(node.attrs?.href ?? "");
    const inner = h.renderChildren(node);
    const text = (ctx?.meta?.markText as string | undefined) ?? inner;
    if (!node.attrs?.title && text === href && /^https?:\/\//.test(href)) return inner;
    return node.attrs?.title ? `[${inner}](${href} "${node.attrs.title}")` : `[${inner}](${href})`;
  },
});

/** Normalized rendered HTML: equal for two markdown texts that look the same. */
function renderedShape(md: string): string {
  return (marked.parse(md, { async: false, gfm: true }) as string)
    .replace(/<\/?p>/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mount the rich editor, or return null if this note can't round-trip exactly. */
export function createRichEditor(parent: HTMLElement, body: string, hooks: EditorHooks): NoteEditor | null {
  const keys = Extension.create({
    name: "vortexKeys",
    addKeyboardShortcuts() {
      return {
        "Mod-s": () => (hooks.onSave(), true),
        "Mod-Shift-l": () => this.editor.chain().focus().toggleTaskList().run(),
        "Mod-k": () => (setLink(this.editor), true),
      };
    },
  });

  const editor = new Editor({
    element: parent,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
      }),
      BareLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Image,
      Wikilink,
      Placeholder.configure({ placeholder: "Start writing…" }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      keys,
    ],
    content: body,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "richdoc", spellcheck: "true" },
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest("a");
        if (!a) return false;
        const wl = a.getAttribute("data-wikilink");
        if (wl !== null) {
          event.preventDefault();
          hooks.onWikilink(wl.split("|")[0]);
          return true;
        }
        const href = a.getAttribute("href");
        if (href && !event.altKey) {
          event.preventDefault();
          window.open(href, "_blank", "noopener");
          return true;
        }
        return false;
      },
    },
  });

  // Refuse notes the rich model would change (compare what both render to).
  let state = snapshot(editor, body);
  if (renderedShape(state.baseline) !== renderedShape(body)) {
    editor.destroy();
    parent.innerHTML = "";
    return null;
  }

  // "Changed" means the markdown changed: editor housekeeping (e.g. the empty
  // paragraph Tiptap adds after a trailing table on first click) is not an edit.
  editor.on("update", () => hooks.onChange());
  editor.on("blur", () => hooks.onBlur());

  return {
    mode: "rich",
    getMarkdown: () => {
      const md = editor.getMarkdown();
      if (md.trimEnd() === state.baseline.trimEnd()) return state.body;
      return minimalMarkdown(editor, state) ?? withTail(md, state.body);
    },
    replaceBody: (md: string) => {
      const { from, to } = editor.state.selection;
      editor.commands.setContent(md, { contentType: "markdown", emitUpdate: false });
      const max = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
      state = snapshot(editor, md);
    },
    focus: () => editor.commands.focus(),
    destroy: () => editor.destroy(),
    format: (kind: FormatKind) => {
      const c = editor.chain().focus();
      const run: Record<FormatKind, () => boolean> = {
        title: () => c.setHeading({ level: 1 }).run(),
        heading: () => c.setHeading({ level: 2 }).run(),
        subheading: () => c.setHeading({ level: 3 }).run(),
        body: () => c.setParagraph().run(),
        bullets: () => c.toggleBulletList().run(),
        numbers: () => c.toggleOrderedList().run(),
        checklist: () => c.toggleTaskList().run(),
        quote: () => c.toggleBlockquote().run(),
        code: () => c.toggleCodeBlock().run(),
        bold: () => c.toggleBold().run(),
        italic: () => c.toggleItalic().run(),
        strike: () => c.toggleStrike().run(),
        link: () => (setLink(editor), true),
      };
      run[kind]();
    },
  };
}

interface Snapshot {
  /** The note body as it was loaded (returned verbatim while nothing changed). */
  body: string;
  /** Tiptap's serialization of that body, to tell real edits from housekeeping. */
  baseline: string;
  /** Top-level blocks at load: node JSON and the exact source text (with the blank lines after it). */
  blocks: { key: string; raw: string }[] | null;
}

/** Pair each top-level node with its source text, so unchanged blocks can be written back untouched. */
function snapshot(editor: Editor, body: string): Snapshot {
  const nodes = editor.getJSON().content ?? [];
  const raws: string[] = [];
  let lead = "";
  for (const t of marked.lexer(body, { gfm: true })) {
    if (t.type === "space") {
      if (raws.length) raws[raws.length - 1] += t.raw;
      else lead += t.raw;
    } else raws.push(t.raw);
  }
  if (raws.length) raws[0] = lead + raws[0];
  const blocks = raws.length === nodes.length ? nodes.map((n, i) => ({ key: JSON.stringify(n), raw: raws[i] })) : null;
  return { body, baseline: editor.getMarkdown(), blocks };
}

/**
 * Markdown for the current doc that changes only the edited blocks: an
 * untouched block keeps its original text (bullet style, table padding),
 * so agents and other devices see a small diff and diff3 merges cleanly.
 * Null when the blocks can't be lined up; the caller serializes everything.
 */
function minimalMarkdown(editor: Editor, st: Snapshot): string | null {
  if (!st.blocks || !editor.markdown) return null;
  let out = "";
  let next = 0; // original blocks are matched in order
  let prevHit = -2;
  for (const node of editor.getJSON().content ?? []) {
    const key = JSON.stringify(node);
    let hit = -1;
    for (let i = next; i < st.blocks.length; i++) {
      if (st.blocks[i].key === key) {
        hit = i;
        break;
      }
    }
    // Pieces that weren't neighbours in the source need a blank line between them.
    const piece = hit >= 0 ? st.blocks[hit].raw : editor.markdown.serialize({ type: "doc", content: [node] });
    if (out && !(hit >= 0 && hit === prevHit + 1)) out = out.replace(/\n*$/, "\n\n");
    out += piece;
    if (hit >= 0) next = hit + 1;
    prevHit = hit;
  }
  out = withTail(out, st.body);
  // Safety net: it must render exactly like the full serialization.
  return renderedShape(out) === renderedShape(editor.getMarkdown()) ? out : null;
}

/** Keep the source's trailing newlines. */
function withTail(md: string, source: string): string {
  return md.replace(/\n*$/, source.match(/\n*$/)![0]);
}

function setLink(editor: Editor): void {
  const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
  const url = prompt("Link address (leave empty to remove):", prev);
  if (url === null) return;
  if (!url.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
  else editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
}
