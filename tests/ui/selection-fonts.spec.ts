import { test, expect } from "@playwright/test";

test("Aa styles a range, preserves text/undo, resets global preferences, and handles fallback fonts", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "daily-notes-editor",
      JSON.stringify({ custom: "Wingdings", size: 24 }),
    ),
  );
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editorPath = "/src/editor.ts",
      formatPath = "/src/formatting.ts";
    const { NoteEditor } = await import(editorPath);
    const { showFormatting, formattingCommands } = await import(formatPath);
    const host = document.createElement("div");
    document.body.append(host);
    const instance = new NoteEditor(
      host,
      () => {},
      () => {},
    );
    Object.assign(window, {
      fontEditor: instance,
      openFonts: () => showFormatting(instance, formattingCommands(instance)),
    });
    instance.load(
      {
        day: "2026-09-22",
        body: "Hello world\n#todo next 😀",
        attachments: [],
        content: null,
        revision: 0,
      },
      new Map(),
      "one",
    );
    instance.editor.commands.setTextSelection({ from: 1, to: 6 });
    showFormatting(instance, formattingCommands(instance));
    return localStorage.getItem("daily-notes-editor");
  });
  expect(result).toBeNull();
  await page.getByLabel("Font", { exact: true }).selectOption("serif");
  await page.getByLabel("Size", { exact: true }).selectOption("18px");
  await page.getByLabel("Line spacing", { exact: true }).selectOption("1.2");
  await page.getByRole("button", { name: "Apply to selection" }).click();
  const styled = await page.evaluate(() => {
    const e = (window as any).fontEditor;
    const snapshot = e.snapshot();
    const html = e.editor.getHTML();
    e.editor.commands.undo();
    const undo = e.snapshot();
    e.editor.commands.redo();
    const redo = e.snapshot();
    e.load({ ...snapshot, day: "2026-09-22", revision: 1 }, new Map(), "one");
    return { snapshot, html, undo, redo, reloaded: e.snapshot() };
  });
  expect(styled.snapshot.body).toBe("Hello world\n#todo next 😀");
  expect(styled.snapshot.content.content[0].content[0]).toMatchObject({
    text: "Hello",
    marks: [
      { type: "textStyle", attrs: { fontFamily: "serif", fontSize: "18px" } },
    ],
  });
  expect(styled.snapshot.content.content[0].content[1]).toEqual({
    type: "text",
    text: " world",
  });
  expect(styled.undo.content.content[0].content[0]).toEqual({
    type: "text",
    text: "Hello world",
  });
  expect(styled.redo).toEqual(styled.snapshot);
  expect(styled.reloaded).toEqual(styled.snapshot);
  expect(styled.snapshot.content.content[0].attrs.lineHeight).toBe(1.2);
  expect(styled.snapshot.content.content[1].attrs).toBeUndefined();
  await page.evaluate(() => {
    const e = (window as any).fontEditor;
    e.editor.commands.setTextSelection({ from: 1, to: 12 });
    (window as any).openFonts();
  });
  await expect(page.getByLabel("Font", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Size", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.evaluate(() => {
    const e = (window as any).fontEditor;
    e.editor.commands.setTextSelection(12);
    (window as any).openFonts();
  });
  await page.getByLabel("Font", { exact: true }).selectOption("monospace");
  await page.getByRole("button", { name: "Apply to selection" }).click();
  const cursor = await page.evaluate(() => {
    const e = (window as any).fontEditor;
    const before = e.snapshot();
    e.editor.commands.insertContent("!");
    const typed = e.snapshot();
    e.editor.commands.setTextSelection({ from: 1, to: 6 });
    e.editor.commands.setFontFamily("MissingFamilyForFallback");
    const computed = getComputedStyle(
      e.editor.view.dom.querySelector('span[style*="MissingFamily"]'),
    ).fontFamily;
    e.editor.commands.setFontFamily("Wingdings");
    const saved = e.snapshot();
    e.load({ ...saved, day: "2026-09-22", revision: 2 }, new Map(), "one");
    return { before, typed, computed, saved, reloaded: e.snapshot() };
  });
  expect(cursor.before).toEqual(styled.snapshot);
  expect(cursor.typed.body).toContain("Hello world!");
  expect(cursor.typed.content.content[0].content.at(-1)).toMatchObject({
    text: "!",
    marks: [{ type: "textStyle", attrs: { fontFamily: "monospace" } }],
  });
  expect(cursor.computed).toContain("MissingFamilyForFallback");
  expect(cursor.computed).toContain("system-ui");
  expect(cursor.saved).toEqual(cursor.reloaded);
  await expect(page.locator("#toast")).toContainText(
    "Symbols may display incorrectly",
  );
  await page.evaluate(() => {
    (window as any).openFonts();
  });
  await page.screenshot({ path: "test-results/selection-fonts.png" });
  await page.evaluate(() => {
    const e = (window as any).fontEditor;
    e.load(
      {
        day: "2026-09-23",
        body: "Other day",
        attachments: [],
        content: null,
        revision: 0,
      },
      new Map(),
      "two",
    );
  });
  await expect(page.locator("#dialog")).not.toBeVisible();
});

test("safe styled paste, plain paste, code exclusion, and clear formatting", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editorPath = "/src/editor.ts",
      formatPath = "/src/formatting.ts";
    const { NoteEditor } = await import(editorPath);
    const { showFormatting, formattingCommands } = await import(formatPath);
    const host = document.createElement("div");
    document.body.append(host);
    const e = new NoteEditor(
      host,
      () => {},
      () => {},
    );
    e.load(
      {
        day: "2026-09-22",
        body: "",
        attachments: [],
        content: null,
        revision: 0,
      },
      new Map(),
      "one",
    );
    const paste = (html: string) => {
      const data = new DataTransfer();
      data.setData("text/plain", "Text\ncode");
      data.setData("text/html", html);
      e.editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    paste(
      '<p style="font-family:Georgia;font-size:18px;line-height:9;margin-bottom:90px;background:url(https://invalid.example/track)">Text</p><pre><code>code</code></pre>',
    );
    const pasted = e.snapshot();
    const html = e.editor.getHTML();
    e.editor.commands.selectAll();
    showFormatting(e, formattingCommands(e));
    const font = document.querySelector<HTMLSelectElement>("#text-font")!;
    font.value = "serif";
    font.dispatchEvent(new Event("change"));
    document.querySelector<HTMLButtonElement>("#apply-typography")!.click();
    const styled = e.snapshot();
    e.editor.commands.selectAll();
    e.clearFormatting();
    const cleared = e.snapshot();
    e.load(
      {
        day: "2026-09-22",
        body: "bold",
        attachments: [],
        content: null,
        revision: 0,
      },
      new Map(),
      "one",
    );
    e.editor.commands.selectAll();
    e.editor.commands.setFontFamily("serif");
    e.replace(1, 5, "literal **text**");
    const plain = e.snapshot();
    e.editor.destroy();
    host.remove();
    return { pasted, html, styled, cleared, plain };
  });
  expect(result.pasted.content.content[0].content[0]).toMatchObject({
    marks: [
      { type: "textStyle", attrs: { fontFamily: "Georgia", fontSize: "18px" } },
    ],
  });
  expect(result.pasted.content.content[0].attrs).toBeUndefined();
  expect(result.html).not.toMatch(/background|url\(|90px|line-height: 9/);
  expect(result.styled.content.content[1].type).toBe("codeBlock");
  expect(result.styled.content.content[1].content[0].marks).toBeUndefined();
  expect(JSON.stringify(result.cleared.content)).not.toMatch(
    /textStyle|fontFamily|fontSize|lineHeight|paragraphSpacing/,
  );
  expect(result.cleared.body).toBe(result.pasted.body);
  expect(result.plain.body).toBe("literal **text**");
  expect(JSON.stringify(result.plain.content)).not.toMatch(/marks|fontFamily/);
});
