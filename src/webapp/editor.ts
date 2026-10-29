/**
 * The note editing surface. Two implementations behind one interface:
 * "rich" (Apple-Notes-style, richedit.ts) is the default; "source" is the
 * raw markdown in CodeMirror (every symbol visible), via ⋯ → Edit markdown.
 * Both edit the note BODY only; main.ts keeps the frontmatter aside.
 */
import { EditorView, minimalSetup } from "codemirror";
import { keymap, ViewUpdate } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { markdownSource } from "./livemd.js";

export type EditorMode = "rich" | "source";

export type FormatKind =
  | "title" | "heading" | "subheading" | "body"
  | "bullets" | "numbers" | "checklist" | "quote" | "code"
  | "bold" | "italic" | "strike" | "link";

export interface NoteEditor {
  mode: EditorMode;
  /** Current body as markdown. Untouched rich notes return the original text byte for byte. */
  getMarkdown(): string;
  focus(): void;
  destroy(): void;
  /** Swap in a newer body (a remote change) without remounting; keeps the selection where it can. */
  replaceBody(md: string): void;
  /** Apply a formatting action (rich mode; a no-op in source mode). */
  format(kind: FormatKind): void;
}

export interface EditorHooks {
  onChange: () => void;
  onSave: () => void;
  onBlur: () => void;
  /** A [[wikilink]] was clicked. */
  onWikilink: (target: string) => void;
}

export function createSourceEditor(parent: HTMLElement, body: string, hooks: EditorHooks): NoteEditor {
  const view = new EditorView({
    doc: body,
    parent,
    extensions: [
      minimalSetup,
      markdown(),
      EditorView.lineWrapping,
      ...markdownSource,
      keymap.of([{ key: "Mod-s", run: () => (hooks.onSave(), true) }]),
      EditorView.updateListener.of((u: ViewUpdate) => {
        if (u.docChanged) hooks.onChange();
      }),
      EditorView.domEventHandlers({ blur: () => hooks.onBlur() }),
    ],
  });
  return {
    mode: "source",
    getMarkdown: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    replaceBody: (md: string) => {
      const sel = view.state.selection.main;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md }, selection: { anchor: Math.min(sel.anchor, md.length), head: Math.min(sel.head, md.length) } });
    },
    format: () => undefined,
  };
}
