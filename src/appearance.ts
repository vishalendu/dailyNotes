import { closeHistory } from "@tiptap/pm/history";
import { Extension, type Editor } from "@tiptap/core";
import { TextStyle, FontFamily, FontSize } from "@tiptap/extension-text-style";
import { api, desktop } from "./api";
import { $, notify } from "./ui";

export const defaultFont = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const symbolFont = (name: string) =>
  /^(wingdings(?:\s*[123])?|webdings|symbol|zapf dingbats)$/i.test(name.trim());
export const validFont = (name: string) =>
  name.length > 0 &&
  name.length <= 100 &&
  !/[\u0000-\u001f\u007f"'\\;,<>{}]/.test(name);
export const validSize = (size: string) => /^(1[2-9]|2[0-4])px$/.test(size);
export const fontCSS = (name: string) =>
  ["serif", "monospace", "system-ui"].includes(name)
    ? name
    : `"${name}", ${defaultFont}`;
export const parseFont = (css: string) => {
  const name = css
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "");
  return validFont(name) ? name : null;
};
export const typographyExtensions = [
  TextStyle,
  FontFamily.extend({
    addGlobalAttributes() {
      return [
        {
          types: ["textStyle"],
          attributes: {
            fontFamily: {
              default: null,
              parseHTML: (el: HTMLElement) => parseFont(el.style.fontFamily),
              renderHTML: (attrs: Record<string, unknown>) =>
                typeof attrs.fontFamily === "string" &&
                validFont(attrs.fontFamily)
                  ? { style: `font-family: ${fontCSS(attrs.fontFamily)}` }
                  : {},
            },
          },
        },
      ];
    },
  }),
  FontSize.configure({ types: ["textStyle"] }),
  Extension.create({
    name: "paragraphSpacing",
    addGlobalAttributes() {
      return [
        {
          types: ["paragraph", "heading"],
          attributes: {
            lineHeight: {
              default: null,
              parseHTML: () => null,
              renderHTML: (a: Record<string, unknown>) =>
                typeof a.lineHeight === "number"
                  ? {
                      style: `line-height: ${a.lineHeight}; min-height: ${a.lineHeight}em`,
                    }
                  : {},
            },
            paragraphSpacing: {
              default: null,
              parseHTML: () => null,
              renderHTML: (a: Record<string, unknown>) =>
                typeof a.paragraphSpacing === "number"
                  ? { style: `margin-bottom: ${a.paragraphSpacing}px` }
                  : {},
            },
          },
        },
      ];
    },
  }),
];

export const typographyHTML = `<section data-typography><p class="muted">Font and size apply to selected text, or your next typing. Spacing applies to selected paragraphs. Code keeps its monospace style.</p><div class="typography-controls"><label class="form-label">Font<select class="field" id="text-font" aria-label="Font"><option value="system-ui">Default · Sans-serif</option><option value="serif">Serif</option><option value="monospace">Monospace</option></select></label><label class="form-label">Size<select class="field" id="text-size" aria-label="Size">${Array.from({ length: 13 }, (_, i) => `<option value="${i + 12}px">${i + 12}px</option>`).join("")}</select></label><label class="form-label">Line spacing<select class="field" id="text-line" aria-label="Line spacing">${Array.from({ length: 11 }, (_, i) => `<option value="${(1 + i / 10).toFixed(1)}">${(1 + i / 10).toFixed(1)}</option>`).join("")}</select></label><label class="form-label">Paragraph spacing<select class="field" id="text-paragraph" aria-label="Paragraph spacing">${[0, 4, 8, 12].map((n) => `<option value="${n}">${n}px</option>`).join("")}</select></label></div><p id="font-status" class="muted" role="status"></p><p id="font-preview">Your notes, your type.</p><button class="button primary" id="apply-typography">Apply to selection</button></section>`;

export function attachTypography(d: HTMLDialogElement, editor: Editor) {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const section = $("[data-typography]", d);
  const controls = [
    "text-font",
    "text-size",
    "text-line",
    "text-paragraph",
  ].map((id) => $<HTMLSelectElement>(`#${id}`, d));
  const [font, size, line, paragraph] = controls;
  const values = controls.map(() => new Set<string>());
  let editableText = false,
    editableBlock = false;
  const inline = (marks: readonly import("@tiptap/pm/model").Mark[]) => {
    if (marks.some((m) => m.type.name === "code")) return;
    editableText = true;
    const attrs = marks.find((m) => m.type.name === "textStyle")?.attrs;
    values[0].add(attrs?.fontFamily ?? "system-ui");
    values[1].add(attrs?.fontSize ?? "14px");
  };
  if (empty && state.selection.$from.parent.type.name !== "codeBlock")
    inline(state.storedMarks ?? state.selection.$from.marks());
  state.doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (node.isText && parent?.type.name !== "codeBlock" && !empty)
      inline(node.marks);
    if (["paragraph", "heading"].includes(node.type.name)) {
      editableBlock = true;
      values[2].add(Number(node.attrs.lineHeight ?? 1.4).toFixed(1));
      values[3].add(String(node.attrs.paragraphSpacing ?? 0));
    }
  });
  controls.forEach((select, i) => {
    const current = values[i].size === 1 ? [...values[i]][0] : "";
    if (!Array.from(select.options).some((o) => o.value === current))
      select.add(new Option(current || "Mixed", current), 0);
    for (const option of Array.from(select.options))
      if (symbolFont(option.value)) option.disabled = true;
    select.value = current;
    select.disabled = i < 2 ? !editableText : !editableBlock;
  });
  const changed = new Set<number>();
  const preview = $("#font-preview", d);
  const updatePreview = () => {
    preview.style.fontFamily = font.value ? fontCSS(font.value) : defaultFont;
    preview.style.fontSize = size.value || "14px";
  };
  controls.forEach(
    (control, i) =>
      (control.onchange = () => {
        changed.add(i);
        updatePreview();
      }),
  );
  updatePreview();
  const status = $("#font-status", d);
  status.textContent = desktop
    ? "Loading installed fonts…"
    : "Installed fonts are listed in the desktop app. Generic families work here.";
  if (desktop)
    void api
      .installedFonts()
      .then((names) => {
        if (!section.isConnected || !d.open) return;
        const selected = font.value;
        for (const name of names.filter(
          (n) => validFont(n) && !symbolFont(n),
        )) {
          if (!Array.from(font.options).some((o) => o.value === name))
            font.add(new Option(name, name));
        }
        // Preserve imported/missing choices, but do not offer symbol fonts for new styling.
        for (const option of Array.from(font.options))
          if (symbolFont(option.value)) option.disabled = true;
        font.value = selected;
        const missing =
          selected &&
          !["system-ui", "serif", "monospace"].includes(selected) &&
          !names.includes(selected);
        status.textContent = missing
          ? `${selected} is unavailable; using the default font.${symbolFont(selected) ? " Symbols may be incorrect. Install the original font or use an image." : ""}`
          : "Known symbol fonts are excluded. Use Unicode symbols or images for portable notes.";
      })
      .catch(() => {
        if (section.isConnected)
          status.textContent =
            "Could not list installed fonts. Generic fonts still work; reopen Aa to retry.";
      });
  $("#apply-typography", d).onclick = () => {
    if (!editor.isEditable || editor.state.doc !== state.doc) {
      d.close();
      notify("The note changed. Select the text again.", true);
      return;
    }
    const tr = closeHistory(editor.state.tr).setSelection(state.selection);
    const attrs: Record<string, string> = {};
    if (changed.has(0) && validFont(font.value) && !symbolFont(font.value))
      attrs.fontFamily = font.value;
    if (changed.has(1) && validSize(size.value)) attrs.fontSize = size.value;
    const markType = state.schema.marks.textStyle;
    if (Object.keys(attrs).length && editableText) {
      if (empty) {
        const marks = state.storedMarks ?? state.selection.$from.marks();
        tr.setStoredMarks(
          markType
            .create({
              ...marks.find((m) => m.type === markType)?.attrs,
              ...attrs,
            })
            .addToSet(marks),
        );
      } else
        state.doc.nodesBetween(from, to, (node, pos, parent) => {
          if (
            !node.isText ||
            parent?.type.name === "codeBlock" ||
            node.marks.some((m) => m.type.name === "code")
          )
            return;
          tr.addMark(
            Math.max(from, pos),
            Math.min(to, pos + node.nodeSize),
            markType.create({
              ...node.marks.find((m) => m.type === markType)?.attrs,
              ...attrs,
            }),
          );
        });
    }
    if (changed.has(2) || changed.has(3))
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!["paragraph", "heading"].includes(node.type.name)) return;
        const a = { ...node.attrs };
        if (changed.has(2) && line.value) a.lineHeight = Number(line.value);
        if (changed.has(3) && paragraph.value)
          a.paragraphSpacing = Number(paragraph.value);
        tr.setNodeMarkup(pos, undefined, a);
      });
    d.close();
    editor.view.dispatch(tr);
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.commands.focus();
  };
}

export async function warnSymbolFonts(editor: Editor) {
  const doc = editor.state.doc;
  const fonts = new Set<string>();
  doc.descendants((node) => {
    node.marks.forEach((m) => {
      const name = m.attrs.fontFamily;
      if (typeof name === "string" && symbolFont(name)) fonts.add(name);
    });
  });
  if (!fonts.size) return;
  let available: string[] | null = null;
  try {
    if (desktop) available = await api.installedFonts();
  } catch {
    /* Cannot verify availability; warn rather than guess. */
  }
  if (editor.state.doc !== doc) return;
  const missing = [...fonts].filter(
    (n) => !available?.some((a) => a.toLowerCase() === n.toLowerCase()),
  );
  if (missing.length)
    notify(
      `${available ? "Symbol font unavailable" : "Symbol font availability unverified"}: ${missing.join(", ")}. Symbols may display incorrectly. Install the original font or use an image. Original text is preserved.`,
      true,
    );
}
