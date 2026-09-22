import { typographyExtensions, warnSymbolFonts } from "./appearance";
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { serialize, deserialize, canonical, withImageUrls } from "./document";
import { plainText, cleanHtml, safeLink, markdownHtml } from "./clipboard";
import { api, desktop } from "./api";
import { DOMSerializer, type Slice } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import type { Note } from "./types";

const LocalImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), imageId: { default: null } };
  },
}).configure({ inline: true, allowBase64: true });
export class NoteEditor {
  editor: Editor;
  private plainPaste = false;
  private libraryId: string | null = null;
  private copied: { token: string; slice: Slice } | null = null;
  reportError: (message: string) => void = () => {};
  constructor(
    element: HTMLElement,
    change: () => void,
    paste: (file: File) => void,
  ) {
    this.editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          underline: false,
          heading: { levels: [1, 2, 3] },
          link: {
            openOnClick: false,
            autolink: false,
            linkOnPaste: false,
            isAllowedUri: safeLink,
          },
          horizontalRule: false,
          trailingNode: false,
        }),
        ...typographyExtensions,
        LocalImage,
        Placeholder.configure({
          placeholder: "A thought, a snippet, something to remember…",
        }),
        Extension.create({
          name: "tabs",
          addKeyboardShortcuts() {
            return {
              Tab: () =>
                this.editor.isActive("listItem")
                  ? this.editor.commands.sinkListItem("listItem")
                  : this.editor.commands.insertContent("  ", {
                      parseOptions: { preserveWhitespace: "full" },
                    }),
              "Shift-Tab": () =>
                this.editor.isActive("listItem")
                  ? this.editor.commands.liftListItem("listItem")
                  : false,
            };
          },
        }),
      ],
      editorProps: {
        handleDOMEvents: {
          copy: (_view, event) => this.copySelection(event, false),
          cut: (_view, event) => this.copySelection(event, true),
        },
        attributes: {
          "aria-label": "Daily note editor",
          role: "textbox",
          "aria-multiline": "true",
          spellcheck: "false",
        },
        handlePaste: (_view, event) => {
          const data = event.clipboardData;
          if (!data) return false;
          const text = data.getData("text/plain");
          const html = data.getData("text/html");
          if (this.plainPaste || this.editor.isActive("codeBlock")) {
            event.preventDefault();
            this.plainPaste = false;
            this.insertText(text);
            return true;
          }
          if (
            this.copied &&
            data.getData("application/x-daily-notes-copy") === this.copied.token
          ) {
            event.preventDefault();
            this.editor.view.dispatch(
              this.editor.state.tr
                .replaceSelection(this.copied.slice)
                .scrollIntoView(),
            );
            return true;
          }
          if (html && text) {
            event.preventDefault();
            this.insertHtml(cleanHtml(html));
            return true;
          }
          const file = Array.from(data.files).find((f) =>
            f.type.startsWith("image/"),
          );
          if (file) {
            event.preventDefault();
            paste(file);
            return true;
          }
          event.preventDefault();
          if (html) this.insertHtml(cleanHtml(html));
          else this.insertText(text);
          return true;
        },
        handleKeyDown: (_view, event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.shiftKey &&
            event.key.toLowerCase() === "v"
          ) {
            this.plainPaste = true;
            // Native menu shortcuts vary; the explicit clipboard path is reliable in Tauri.
            if (desktop) {
              event.preventDefault();
              void this.pastePlain().catch((e) => this.reportError(String(e)));
            } else setTimeout(() => (this.plainPaste = false), 1000);
            return desktop;
          }
          return false;
        },
        handleDrop: (_view, event) => {
          const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
            f.type.startsWith("image/"),
          );
          if (file) {
            event.preventDefault();
            paste(file);
            return true;
          }
          return false;
        },
      },
      onUpdate: () => change(),
    });
  }
  load(note: Note, urls: Map<number, string>, libraryId: string | null = null) {
    document
      .querySelector<HTMLDialogElement>("dialog:has([data-typography])")
      ?.close();
    if (this.libraryId !== libraryId) this.copied = null;
    this.libraryId = libraryId;
    // A new editor state clears the previous page's undo history.
    const doc = this.editor.schema.nodeFromJSON(
      note.content
        ? withImageUrls(note.content, urls)
        : deserialize(note.body, note.attachments, urls),
    );
    const State = this.editor.state
      .constructor as typeof import("@tiptap/pm/state").EditorState;
    this.editor.view.updateState(
      State.create({
        schema: this.editor.schema,
        doc,
        plugins: this.editor.state.plugins,
      }),
    );
    void warnSymbolFonts(this.editor);
  }
  snapshot() {
    const content = canonical(this.editor.getJSON());
    return { ...serialize(content), content };
  }
  private copySelection(event: ClipboardEvent, cut: boolean) {
    if (!event.clipboardData || this.editor.state.selection.empty) return false;
    const slice = this.editor.state.selection.content();
    const container = document.createElement("div");
    container.append(
      DOMSerializer.fromSchema(this.editor.schema).serializeFragment(
        slice.content,
      ),
    );
    const token = crypto.randomUUID();
    event.clipboardData.setData(
      "text/plain",
      slice.content.textBetween(0, slice.content.size, "\n", "\uFFFC"),
    );
    event.clipboardData.setData("text/html", container.innerHTML);
    event.clipboardData.setData("application/x-daily-notes-copy", token);
    this.copied = { token, slice };
    event.preventDefault();
    if (cut && this.editor.isEditable)
      this.editor.view.dispatch(this.editor.state.tr.deleteSelection());
    return true;
  }
  insertText(text: string) {
    const { from, to } = this.editor.state.selection;
    this.replace(from, to, text);
  }
  async pastePlain() {
    if (!this.editor.isEditable)
      throw new Error("Open a readable page before pasting.");
    this.plainPaste = false;
    const state = this.editor.state;
    const text = desktop
      ? await api.clipboardText()
      : await navigator.clipboard.readText();
    if (
      this.editor.state.doc !== state.doc ||
      this.editor.state.selection.from !== state.selection.from ||
      this.editor.state.selection.to !== state.selection.to
    )
      throw new Error(
        "The selection changed while reading the clipboard. Paste again.",
      );
    this.insertText(text);
  }
  historyBoundary() {
    this.editor.view.dispatch(closeHistory(this.editor.state.tr));
  }
  private insertHtml(html: string) {
    this.historyBoundary();
    this.editor.commands.insertContent(html, {
      parseOptions: { preserveWhitespace: "full" },
    });
    this.historyBoundary();
    void warnSymbolFonts(this.editor);
  }
  convertMarkdown() {
    const s = this.selection();
    if (s.from === s.to)
      throw new Error("Select Markdown text to convert first.");
    if (s.image) throw new Error("Select text only for Markdown conversion.");
    this.historyBoundary();
    this.editor
      .chain()
      .focus()
      .insertContentAt({ from: s.from, to: s.to }, markdownHtml(s.text), {
        parseOptions: { preserveWhitespace: "full" },
      })
      .run();
    this.historyBoundary();
  }
  clearFormatting() {
    this.historyBoundary();
    this.editor
      .chain()
      .focus()
      .unsetAllMarks()
      .resetAttributes("paragraph", ["lineHeight", "paragraphSpacing"])
      .resetAttributes("heading", ["lineHeight", "paragraphSpacing"])
      .clearNodes()
      .run();
    this.historyBoundary();
  }
  insertImage(id: number, url: string) {
    this.historyBoundary();
    this.editor
      .chain()
      .focus()
      .insertContent({
        type: "image",
        attrs: { imageId: id, src: url, alt: "Pasted image" },
      })
      .run();
    this.historyBoundary();
  }
  selection() {
    const { from, to } = this.editor.state.selection;
    let image = false;
    this.editor.state.doc.nodesBetween(from, to, (n) => {
      if (n.type.name === "image") image = true;
    });
    return {
      from,
      to,
      image,
      text: this.editor.state.doc.textBetween(from, to, "\n", "\uFFFC"),
    };
  }
  replace(from: number, to: number, text: string) {
    if (!this.editor.isEditable)
      throw new Error("Open a readable page before editing.");
    this.editor.view.dispatch(closeHistory(this.editor.state.tr));
    text = plainText(text);
    const state = this.editor.state;
    const selectedBlock = state.doc.nodeAt(from);
    if (
      selectedBlock?.type.name === "codeBlock" &&
      to === from + selectedBlock.nodeSize
    ) {
      from++;
      to--;
    }
    const start = state.doc.resolve(from),
      end = state.doc.resolve(to);
    if (start.parent.type.name === "codeBlock" && start.sameParent(end)) {
      const tr = text
        ? state.tr.replaceWith(from, to, state.schema.text(text))
        : state.tr.delete(from, to);
      this.editor.view.dispatch(tr.setStoredMarks([]));
      this.editor.view.dispatch(closeHistory(this.editor.state.tr));
      return;
    }
    this.editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .unsetAllMarks()
      .insertContent(deserialize(text, [], new Map()).content ?? [], {
        parseOptions: { preserveWhitespace: "full" },
      })
      .run();
    this.editor.view.dispatch(closeHistory(this.editor.state.tr));
  }
  jump(offset: number, length = 0) {
    const positions: number[] = [];
    let blocks = 0;
    this.editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock) {
        if (blocks++) positions.push(pos + 1);
      }
      if (node.isText)
        for (let i = 0; i < (node.text?.length ?? 0); i++)
          positions.push(pos + i);
      else if (node.type.name === "image" || node.type.name === "hardBreak")
        positions.push(pos);
    });
    const end = Math.max(1, this.editor.state.doc.content.size - 1);
    const from = positions[Math.min(offset, positions.length)] ?? end;
    const to = length
      ? (positions[Math.min(offset + length, positions.length)] ?? end)
      : from;
    this.editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .scrollIntoView()
      .run();
  }
  focus() {
    this.editor.commands.focus();
  }
  editable(value: boolean) {
    this.editor.setEditable(value, false);
  }
}
