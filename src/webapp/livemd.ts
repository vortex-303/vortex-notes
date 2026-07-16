/**
 * Live-preview markdown for CodeMirror 6 — the Obsidian model:
 * the document IS the editor. Formatting renders in place (headings big,
 * bold bold, bullets as bullets, frontmatter collapsed to "⋯ properties"),
 * and the raw syntax marks reveal themselves only on lines the cursor
 * touches. No mode switch, no bounding box.
 */
import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { syntaxTree, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// ---------- typography: match the rendered article ----------
const mdHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.55em", fontWeight: "700", fontFamily: "var(--serif)" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "700", fontFamily: "var(--serif)" },
  { tag: tags.heading3, fontSize: "1.1em", fontWeight: "700", fontFamily: "var(--serif)" },
  { tag: tags.heading4, fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--ink-faint)" },
  { tag: tags.monospace, fontFamily: "var(--mono)", fontSize: "0.86em" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--ink-faint)" },
  { tag: tags.quote, color: "var(--ink-soft)", fontStyle: "italic" },
  { tag: tags.processingInstruction, color: "var(--ink-faint)" },
  { tag: tags.meta, color: "var(--ink-faint)" },
  { tag: tags.contentSeparator, color: "var(--ink-faint)" },
]);

// Marks hidden when their line is not being edited. (LinkMark stays visible
// to avoid colliding with our manual [[wikilink]] decorations.)
const HIDDEN_MARKS = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark", "QuoteMark"]);

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "cm-bullet";
    s.textContent = "•";
    return s;
  }
  eq(): boolean {
    return true;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const decos: Range<Decoration>[] = [];

  const activeLines = new Set<number>();
  let selMin = Infinity;
  for (const r of state.selection.ranges) {
    selMin = Math.min(selMin, r.from);
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) activeLines.add(i);
  }

  // Frontmatter is stripped from the editor doc by the caller (edited as the
  // body only), so there is no frontmatter block to collapse here — and block
  // decorations from a ViewPlugin are forbidden by CodeMirror anyway.
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        const lineNo = state.doc.lineAt(n.from).number;

        if (n.name === "ListMark") {
          const txt = state.sliceDoc(n.from, n.to);
          if ((txt === "-" || txt === "*" || txt === "+") && !activeLines.has(lineNo)) {
            decos.push(Decoration.replace({ widget: new BulletWidget() }).range(n.from, n.to));
          }
          return;
        }
        if (!HIDDEN_MARKS.has(n.name) || activeLines.has(lineNo)) return;
        let end = n.to;
        // "# Heading" / "> quote": swallow the following space with the mark.
        if ((n.name === "HeaderMark" || n.name === "QuoteMark") && state.sliceDoc(end, end + 1) === " ") end++;
        decos.push(Decoration.replace({}).range(n.from, end));
      },
    });

    // [[wikilinks]] — styled always; brackets hidden off the active line.
    const text = state.sliceDoc(from, to);
    for (const m of text.matchAll(/\[\[([^\][]+?)\]\]/g)) {
      const s = from + (m.index ?? 0);
      const e = s + m[0].length;
      const lineNo = state.doc.lineAt(s).number;
      if (!activeLines.has(lineNo)) {
        decos.push(Decoration.replace({}).range(s, s + 2));
        decos.push(Decoration.mark({ class: "cm-wikilink" }).range(s + 2, e - 2));
        decos.push(Decoration.replace({}).range(e - 2, e));
      } else {
        decos.push(Decoration.mark({ class: "cm-wikilink" }).range(s + 2, e - 2));
      }
    }
  }
  return Decoration.set(decos, true);
}

const livePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = buildDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);

const liveTheme = EditorView.theme({
  "&": { fontSize: "1.02rem", backgroundColor: "transparent" },
  ".cm-content": {
    fontFamily: "var(--serif)",
    lineHeight: "1.68",
    padding: "0 0 35vh",
    caretColor: "var(--accent)",
  },
  ".cm-line": { padding: "0" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--accent-soft)",
  },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
});

export const livePreview = [syntaxHighlighting(mdHighlight), livePlugin, liveTheme];
