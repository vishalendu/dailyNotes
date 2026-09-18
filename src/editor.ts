import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { serialize, deserialize } from "./document";
import type { Note } from "./types";

const LocalImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), imageId: { default: null } };
  },
}).configure({ inline: true, allowBase64: true });
export class NoteEditor {
  editor: Editor;
  constructor(
    element: HTMLElement,
    change: () => void,
    paste: (file: File) => void,
  ) {
    this.editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          bold: false,
          italic: false,
          strike: false,
          underline: false,
          code: false,
          codeBlock: false,
          blockquote: false,
          heading: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          listKeymap: false,
          horizontalRule: false,
          link: false,
          trailingNode: false,
        }),
        LocalImage,
        Placeholder.configure({
          placeholder: "A thought, a snippet, something to remember…",
        }),
        Extension.create({
          name: "tabs",
          addKeyboardShortcuts() {
            return { Tab: () => this.editor.commands.insertContent("  ") };
          },
        }),
      ],
      editorProps: {
        attributes: {
          "aria-label": "Daily note editor",
          role: "textbox",
          "aria-multiline": "true",
          spellcheck: "false",
        },
        handlePaste: (_view, event) => {
          const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
            f.type.startsWith("image/"),
          );
          if (file) {
            event.preventDefault();
            paste(file);
            return true;
          }
          const text = event.clipboardData?.getData("text/plain");
          if (text !== undefined) {
            event.preventDefault();
            this.insertText(text.replaceAll("\uFFFC", "�"));
            return true;
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
  load(note: Note, urls: Map<number, string>) {
    // A new editor state clears the previous page's undo history.
    const doc = this.editor.schema.nodeFromJSON(
      deserialize(note.body, note.attachments, urls),
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
  }
  snapshot() {
    return serialize(this.editor.getJSON());
  }
  insertText(text: string) {
    this.editor.commands.insertContent(
      deserialize(text, [], new Map()).content ?? [],
    );
  }
  insertImage(id: number, url: string) {
    this.editor
      .chain()
      .focus()
      .insertContent({
        type: "image",
        attrs: { imageId: id, src: url, alt: "Pasted image" },
      })
      .run();
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
    this.editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .insertContent(deserialize(text, [], new Map()).content ?? [])
      .run();
  }
  jump(offset: number, length = 0) {
    let cursor = 0,
      target = 1;
    let found = false;
    this.editor.state.doc.forEach((block, blockPos, index) => {
      if (index) cursor++;
      block.descendants((node, pos) => {
        if (found) return false;
        const size = node.isText
          ? (node.text?.length ?? 0)
          : node.type.name === "image" || node.type.name === "hardBreak"
            ? 1
            : 0;
        if (size && cursor + size > offset) {
          target = blockPos + 1 + pos + Math.max(0, offset - cursor);
          found = true;
        }
        cursor += size;
      });
    });
    this.editor
      .chain()
      .focus()
      .setTextSelection({
        from: target,
        to: Math.min(target + length, this.editor.state.doc.content.size),
      })
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
