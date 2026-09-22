import type { Command } from "./types";
import type { NoteEditor } from "./editor";
import { $, showDialog, notify, escape, mod } from "./ui";
import { attachTypography, typographyHTML } from "./appearance";
import { safeLink } from "./clipboard";

export function formattingCommands(editor: NoteEditor): Command[] {
  const run = (action: () => unknown) => () => {
    action();
  };
  return [
    {
      id: "bold",
      title: "Bold",
      shortcut: `${mod} B`,
      run: run(() => editor.editor.chain().focus().toggleBold().run()),
    },
    {
      id: "italic",
      title: "Italic",
      shortcut: `${mod} I`,
      run: run(() => editor.editor.chain().focus().toggleItalic().run()),
    },
    {
      id: "strike",
      title: "Strikethrough",
      run: run(() => editor.editor.chain().focus().toggleStrike().run()),
    },
    {
      id: "inline-code",
      title: "Inline code",
      run: run(() => editor.editor.chain().focus().toggleCode().run()),
    },
    {
      id: "paragraph",
      title: "Normal paragraph",
      run: run(() => editor.editor.chain().focus().setParagraph().run()),
    },
    ...([1, 2, 3] as const).map((level) => ({
      id: `heading-${level}`,
      title: `Heading ${level}`,
      run: run(() =>
        editor.editor.chain().focus().toggleHeading({ level }).run(),
      ),
    })),
    {
      id: "bullet-list",
      title: "Bullet list",
      run: run(() => editor.editor.chain().focus().toggleBulletList().run()),
    },
    {
      id: "numbered-list",
      title: "Numbered list",
      run: run(() => editor.editor.chain().focus().toggleOrderedList().run()),
    },
    {
      id: "blockquote",
      title: "Blockquote",
      run: run(() => editor.editor.chain().focus().toggleBlockquote().run()),
    },
    {
      id: "code-block",
      title: "Code block",
      run: run(() => editor.editor.chain().focus().toggleCodeBlock().run()),
    },
    {
      id: "link",
      title: "Add or edit link",
      run: () => {
        const selection = editor.selection();
        const d = showDialog(
          "Link",
          '<label class="form-label">URL<input id="link-url" class="field" placeholder="https://…"></label><div class="actions"><button class="button" id="remove-link">Remove link</button><button class="button primary" id="apply-link">Apply link</button></div>',
        );
        $<HTMLInputElement>("#link-url", d).value =
          editor.editor.getAttributes("link").href ?? "";
        $("#remove-link", d).onclick = () => {
          d.close();
          editor.editor
            .chain()
            .focus()
            .setTextSelection(selection)
            .extendMarkRange("link")
            .unsetLink()
            .run();
        };
        $("#apply-link", d).onclick = () => {
          const href = $<HTMLInputElement>("#link-url", d).value.trim();
          if (!safeLink(href)) {
            notify("Use an http, https, or mailto URL.", true);
            return;
          }
          d.close();
          const chain = editor.editor
            .chain()
            .focus()
            .setTextSelection(selection)
            .extendMarkRange("link");
          if (
            selection.from === selection.to &&
            !editor.editor.isActive("link")
          )
            chain
              .insertContent({
                type: "text",
                text: href,
                marks: [{ type: "link", attrs: { href } }],
              })
              .run();
          else chain.setLink({ href }).run();
        };
      },
    },
    {
      id: "clear-formatting",
      title: "Clear formatting",
      run: () => editor.clearFormatting(),
    },
    {
      id: "convert-markdown",
      title: "Convert selection from Markdown",
      run: () => editor.convertMarkdown(),
    },
    {
      id: "paste-plain",
      title: "Paste without formatting",
      shortcut: `${mod} ⇧ V`,
      run: () => editor.pastePlain(),
    },
  ].map((c) => ({
    ...c,
    description: "",
    group: "Formatting",
    run: () => {
      if (!editor.editor.isEditable)
        throw new Error("Open a readable page before formatting.");
      return c.run();
    },
  }));
}
export function showFormatting(editor: NoteEditor, commands: Command[]) {
  const names = [
    "heading",
    "codeBlock",
    "bulletList",
    "orderedList",
    "blockquote",
  ].filter((t) => editor.editor.isActive(t));
  const d = showDialog(
    "Formatting",
    `${typographyHTML}<p class="muted">Current block: ${escape(names.join(" / ") || "paragraph")}</p><div class="format-actions">${commands.map((c, i) => `<button class="button" data-format="${i}">${escape(c.title)}${c.shortcut ? ` <kbd>${escape(c.shortcut)}</kbd>` : ""}</button>`).join("")}</div>`,
  );
  attachTypography(d, editor.editor);
  d.querySelectorAll<HTMLElement>("[data-format]").forEach(
    (b) =>
      (b.onclick = () => {
        d.close();
        void Promise.resolve()
          .then(() => commands[Number(b.dataset.format)].run())
          .catch((e) => notify(String(e), true));
      }),
  );
}
export function installEditorContextMenu(
  editor: NoteEditor,
  commands: Command[],
) {
  const menu = document.createElement("div");
  menu.className = "editor-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  document.body.append(menu);
  const items = commands.filter((c) =>
    ["paste-plain", "clear-formatting", "code-block"].includes(c.id),
  );
  menu.innerHTML = items
    .map(
      (c, i) =>
        `<button role="menuitem" data-action="${i}">${escape(c.title)}</button>`,
    )
    .join("");
  $("#editor").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    menu.hidden = false;
    menu.style.left = `${Math.max(0, Math.min(e.clientX, window.innerWidth - 260))}px`;
    menu.style.top = `${Math.max(0, Math.min(e.clientY, window.innerHeight - 150))}px`;
    menu.querySelector<HTMLButtonElement>("button")?.focus();
  });
  menu.querySelectorAll<HTMLButtonElement>("button").forEach(
    (b) =>
      (b.onclick = () => {
        menu.hidden = true;
        void Promise.resolve()
          .then(() => items[Number(b.dataset.action)].run())
          .catch((e) => notify(String(e), true));
      }),
  );
  menu.onkeydown = (e) => {
    const buttons = Array.from(
      menu.querySelectorAll<HTMLButtonElement>("button"),
    );
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      buttons[
        (i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length
      ].focus();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      menu.hidden = true;
      editor.focus();
    }
  };
  document.addEventListener("pointerdown", (e) => {
    if (!menu.contains(e.target as Node)) menu.hidden = true;
  });
}
