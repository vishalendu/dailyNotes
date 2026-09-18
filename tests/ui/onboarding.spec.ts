import { test, expect } from "@playwright/test";

test("first launch can close, create a library, and save a real edit", async ({
  page,
}) => {
  // Exercise the desktop UI with an in-memory IPC boundary; Rust tests cover SQLite.
  await page.addInitScript(() => {
    const calls: string[] = [];
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, number>();
    let nextId = 0;
    let folderPicks = 0;
    const bookmarks: { id: number; name: string }[] = [];
    let assignments: number[] = [];
    let lastSearch: Record<string, unknown> = {};
    let library = {
      path: null as string | null,
      id: null as string | null,
      error: null,
      background: false,
      default_folder: "/test/Library",
      archive_days: 90,
    };
    Object.assign(window, {
      isTauri: true,
      testCalls: calls,
      testSearch: () => lastSearch,
      testEvent: (event: string) =>
        callbacks.get(listeners.get(event)!)?.({ event, payload: null }),
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" } },
        transformCallback: (callback: (event: unknown) => void) => {
          callbacks.set(++nextId, callback);
          return nextId;
        },
        invoke: async (command: string, args: Record<string, unknown>) => {
          calls.push(command);
          switch (command) {
            case "library_info":
              return library;
            case "model_status":
              return { state: "ready", progress: 1, message: "Ready" };
            case "plugin:event|listen":
              listeners.set(String(args.event), Number(args.handler));
              return nextId;
            case "plugin:dialog|open":
              if (!(args.options as { directory?: boolean }).directory)
                throw new Error("Expected a folder picker");
              return ++folderPicks === 1 ? null : "/chosen/Notes";
            case "choose_library":
              if (args.path !== "/chosen/Notes/DailyNotes.sqlite")
                throw new Error("Did not use the selected folder");
              library = {
                ...library,
                path: String(args.path),
                id: "test-library",
              };
              return library;
            case "get_note":
              return {
                day: args.day,
                body: "",
                attachments: [],
                revision: 0,
                archived: false,
                updated_at: "",
              };
            case "bookmarks":
              return bookmarks.map((b) => ({
                ...b,
                assigned: assignments.includes(b.id),
              }));
            case "create_bookmark": {
              const id = bookmarks.length + 1;
              bookmarks.push({ id, name: String(args.name) });
              return id;
            }
            case "assign_bookmarks":
              assignments = args.ids as number[];
              return;
            case "collection_hits":
              lastSearch = args.search as Record<string, unknown>;
              return [
                {
                  day: "2020-01-01",
                  snippet:
                    lastSearch.kind === "todos"
                      ? "#TODO Review release"
                      : "My first real note",
                  archived: false,
                  score: 0,
                  offset: 0,
                },
              ];
            case "note_neighbors":
              return [null, null];
            case "save_note":
              return {
                ...(args.note as object),
                revision: 1,
                updated_at: new Date().toISOString(),
              };
            case "finish_close":
            case "hide_window":
              return;
            case "library_stats":
              return { active: 1, archived: 0, pending: 0, bytes: 1024 };
            case "hotkey_status":
              return {
                shortcut: "Control+Alt+Space",
                registered: true,
                error: null,
              };
            case "set_hotkey":
              return {
                shortcut: args.shortcut,
                registered: Boolean(args.shortcut),
                error: null,
              };
            default:
              throw new Error(`Unexpected command: ${command}`);
          }
        },
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Create my library" }),
  ).toBeVisible();
  await expect(page.locator("#save-label")).toHaveText("Ready when you are");
  await page.evaluate(() =>
    (window as unknown as { testEvent: (name: string) => void }).testEvent(
      "tauri://close-requested",
    ),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { testCalls: string[] }).testCalls.includes(
          "finish_close",
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Create my library" }).click();
  await expect(page.locator("#dialog")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as { testCalls: string[] }).testCalls.includes(
        "choose_library",
      ),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Create my library" }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator("#save-label")).toHaveText("Ready when you are");
  await expect(
    page.getByRole("button", { name: "Previous day" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();
  await page.getByLabel("Choose note date").fill("2020-01-01");
  await expect(page.locator("#day-label")).toHaveText("A PAGE FROM YOUR DAYS");
  await expect(page.locator("#save-label")).toHaveText("Ready when you are");
  expect(
    await page.evaluate(() =>
      (window as unknown as { testCalls: string[] }).testCalls.includes(
        "save_note",
      ),
    ),
  ).toBe(false);
  await page
    .getByRole("textbox", { name: "Daily note editor" })
    .fill("My first real note");
  await expect(page.locator("#save-label")).toHaveText("All changes saved");
  await page
    .getByRole("button", { name: "Bookmark this page", exact: true })
    .click();
  for (const name of ["Work", "Ideas"]) {
    await page.getByRole("textbox", { name: "New bookmark name" }).fill(name);
    await page
      .getByRole("button", { name: "Create bookmark", exact: true })
      .click();
    await expect(
      page.getByRole("checkbox", { name, exact: true }),
    ).toBeChecked();
  }
  await page.getByRole("button", { name: "Apply bookmarks" }).click();
  await expect(page.locator("#bookmark-labels")).toHaveText("Work · Ideas");
  await page
    .getByRole("button", { name: "Bookmark this page", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Work", exact: true }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "Ideas", exact: true }).uncheck();
  await page.getByRole("button", { name: "Apply bookmarks" }).click();
  await expect(page.locator("#bookmark-labels")).toHaveText("Work");
  await page.getByRole("button", { name: "TODOs", exact: true }).click();
  await expect(page.getByLabel("Collection days")).toHaveValue("7");
  await expect(page.locator("#collections-panel .result")).toContainText(
    "#TODO Review release",
  );
  await page.getByLabel("Collection days").fill("30");
  await page.getByRole("textbox", { name: "Search TODOs" }).fill("release");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { testSearch: () => Record<string, unknown> }
        ).testSearch(),
      ),
    )
    .toMatchObject({ kind: "todos", days: 30, query: "release" });
  await page.screenshot({ path: "test-results/daily-notes-todos.png" });
  await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
  await page.getByLabel("Filter bookmark").selectOption({ label: "Work" });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { testSearch: () => Record<string, unknown> }
        ).testSearch(),
      ),
    )
    .toMatchObject({ kind: "bookmarks", bookmark_id: 1, days: null });
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "TODOs at a glance" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bookmark your pages" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read the user guide" }).click();
  await expect(page.locator(".guide")).toContainText("last 7 days");
  await expect(page.locator(".guide")).toContainText("Apply bookmarks");
  await expect(page.locator(".guide")).toContainText("Control+Option+Space");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Global shortcut")).toHaveValue(
    "Control+Alt+Space",
  );
  await page.getByLabel("Global shortcut").fill("");
  await page.getByRole("button", { name: "Save shortcut" }).click();
  await expect(page.locator("#hotkey-status")).toHaveText("Shortcut disabled");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("textbox", { name: "Daily note editor" })
    .fill("Save this before hiding");
  await page.evaluate(() =>
    (window as unknown as { testEvent: (name: string) => void }).testEvent(
      "request-hide",
    ),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { testCalls: string[] }).testCalls.slice(-2),
      ),
    )
    .toEqual(["save_note", "hide_window"]);
});
