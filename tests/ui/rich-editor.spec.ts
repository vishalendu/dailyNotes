import { test, expect, type Page } from "@playwright/test";
async function command(page: Page, name: string) {
  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.getByRole("textbox", { name: "Search commands" }).fill(name);
  await page.getByRole("option", { name: new RegExp(`^${name}`) }).click();
}
async function paste(page: Page, text: string, html = "") {
  await page.getByRole("textbox", { name: "Daily note editor" }).evaluate(
    (el, data) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", data.text);
      if (data.html) clipboardData.setData("text/html", data.html);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { text, html },
  );
}
test("compact appearance, rich paste, Markdown, code tools and plain clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Daily note editor" });
  await expect(editor).toHaveCSS("line-height", "19.6px");
  await editor.click();
  await paste(
    page,
    "Bold\nCode",
    '<p style="font-size:60px;margin-bottom:100px"><strong>Bold</strong></p><pre><code>const x = 1;\n  x++;</code></pre><img src="https://tracker.invalid/image" data-image-id="42"><script>throw Error("bad")</script>',
  );
  await expect(editor.locator("strong")).toHaveText("Bold");
  await expect(editor.locator("pre")).toContainText("  x++;");
  await expect(editor.locator("[style],img,script")).toHaveCount(0);
  await editor.fill(
    "## A heading\n\n**Strong** and `inline`\n\n- #todo review",
  );
  await editor.press("ControlOrMeta+a");
  await command(page, "Convert selection from Markdown");
  await expect(editor.locator("h2")).toHaveText("A heading");
  await expect(editor.locator("strong")).toHaveText("Strong");
  await expect(editor.locator("li")).toContainText("#todo review");
  await editor.press("ControlOrMeta+a");
  await command(page, "Clear formatting");
  await expect(editor.locator("h2,strong,ul,code")).toHaveCount(0);
  await editor.fill('{"id":9007199254740993123,"ok":true}');
  await command(page, "Code block");
  await editor.press("ControlOrMeta+a");
  await command(page, "Format JSON");
  await expect(editor.locator("pre")).toContainText('"ok": true');
  await expect(editor.locator("pre")).toContainText("9007199254740993123");
  await editor.press("ControlOrMeta+z");
  await expect(editor.locator("pre")).toHaveText(
    '{"id":9007199254740993123,"ok":true}',
  );
  await editor.press("ControlOrMeta+a");
  await command(page, "Normal paragraph");
  await editor.fill("bold text");
  await editor.press("ControlOrMeta+a");
  await command(page, "Bold");
  await page.evaluate(() =>
    navigator.clipboard.writeText("  literal **text**\n\n#todo keep"),
  );
  await editor.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Paste without formatting" }),
  ).toBeVisible();
  await page
    .getByRole("menuitem", { name: "Paste without formatting" })
    .click();
  await expect(editor).toContainText("literal **text**");
  await expect(editor.locator("strong")).toHaveCount(0);
  await page.screenshot({ path: "test-results/rich-editor.png" });
  expect(errors).toEqual([]);
});

test("rich document round-trip, nested TODO position, and scoped image copy", async ({
  page,
}) => {
  const { readFileSync } = await import("node:fs");
  const fixture = JSON.parse(
    readFileSync(
      new URL("../fixtures/rich-document.json", import.meta.url),
      "utf8",
    ),
  );
  await page.goto("/");
  const result = await page.evaluate(async (fixture) => {
    const path = "/src/editor.ts";
    const { NoteEditor } = await import(path);
    const host = document.createElement("div");
    document.body.append(host);
    const instance = new NoteEditor(
      host,
      () => {},
      () => {},
    );
    const note = {
      ...fixture,
      day: "2026-09-22",
      revision: 1,
      archived: false,
      updated_at: "",
    };
    const url =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=";
    instance.load(note, new Map([[1, url]]), "library-one");
    const snapshot = instance.snapshot();
    instance.jump(fixture.body.indexOf("#todo"), 5);
    const selected = instance.selection().text;
    instance.editor.commands.selectAll();
    const data = new DataTransfer();
    instance.editor.view.dom.dispatchEvent(
      new ClipboardEvent("copy", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    const empty = { ...note, content: null, body: "", attachments: [] };
    instance.load(empty, new Map(), "library-one");
    instance.editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    const same = instance.snapshot();
    instance.load(empty, new Map(), "library-two");
    instance.editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    const other = instance.snapshot();
    instance.editor.destroy();
    host.remove();
    return { snapshot, selected, same, other };
  }, fixture);
  expect(result.snapshot).toEqual(fixture);
  expect(result.selected).toBe("#todo");
  expect(result.same.attachments).toEqual(fixture.attachments);
  expect(result.other.attachments).toEqual([]);
});

test("Markdown typing formats immediately but TODO tags stay literal", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Daily note editor" });
  await editor.pressSequentially("#todo review");
  await expect(editor.locator("p")).toHaveText("#todo review");
  await expect(editor.locator("h1")).toHaveCount(0);
  await editor.press("Enter");
  await editor.pressSequentially("## Heading");
  await expect(editor.locator("h2")).toHaveText("Heading");
  await editor.press("Enter");
  await editor.pressSequentially("**bold** ");
  await expect(editor.locator("strong")).toHaveText("bold");
});
