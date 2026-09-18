import { test, expect } from "@playwright/test";

test("daily editor, JSON tool, palette, help, date navigation and theme", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Daily note editor" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Daily note editor" })
    .fill('{"hello":"world","id":9007199254740993123}');
  await page
    .getByRole("textbox", { name: "Daily note editor" })
    .press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Open command palette" }).click();
  await page
    .getByRole("textbox", { name: "Search commands" })
    .fill("format json");
  await page.getByRole("option", { name: /Format JSON/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Daily note editor" }),
  ).toContainText("9007199254740993123");
  await expect(
    page.getByRole("textbox", { name: "Daily note editor" }),
  ).toContainText('"hello": "world"');
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little space for your day." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read the user guide" }).click();
  await expect(
    page.getByRole("heading", { name: "User guide", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Switch appearance" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".page-area")).toHaveCSS(
    "background-color",
    "rgb(32, 40, 34)",
  );
  await expect(page.locator("#page-title")).toHaveCSS(
    "color",
    "rgb(228, 231, 217)",
  );
  await expect(page.locator(".brand")).toHaveCSS("color", "rgb(228, 231, 217)");
  await page.screenshot({ path: "test-results/daily-notes-dark.png" });
  await page.getByRole("button", { name: "Switch appearance" }).click();
  await expect(page.locator(".page-area")).toHaveCSS(
    "background-color",
    "rgb(245, 244, 239)",
  );
  await page.screenshot({ path: "test-results/daily-notes-light.png" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  const editor = await page
    .getByRole("textbox", { name: "Daily note editor" })
    .boundingBox();
  const workspace = await page.locator(".page-area").boundingBox();
  expect(editor!.width).toBeGreaterThan(workspace!.width * 0.9);
  expect(editor!.height).toBeGreaterThan(workspace!.height * 0.6);
  await page.screenshot({ path: "test-results/daily-notes-wide.png" });
  await page.getByLabel("Choose note date").fill("2020-01-01");
  await expect(page.locator("#day-label")).toHaveText("A PAGE FROM YOUR DAYS");
  expect(errors).toEqual([]);
});
