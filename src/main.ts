import "./styles.css";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import icon from "../assets/daily-notes-icon.png";
import { api, desktop } from "./api";
import { NoteEditor } from "./editor";
import {
  formattingCommands,
  showFormatting,
  installEditorContextMenu,
} from "./formatting";
import { Palette } from "./palette";
import { SearchPanel } from "./search";
import { Collections } from "./collections";
import { Settings } from "./settings";
import { showHelp } from "./help";
import { toolCommands } from "./tools";
import {
  $,
  icons,
  escape,
  today,
  dateLabel,
  mod,
  notify,
  showDialog,
} from "./ui";
import type { Note, LibraryInfo, Command, ModelStatus } from "./types";

$("#app").innerHTML =
  `<div class="app-shell"><header class="topbar"><button class="brand" id="brand" aria-label="Go to today"><img src="${icon}" alt=""><span>daily<span class="brand-light">notes</span><small>A LITTLE SPACE FOR YOUR DAY</small></span></button><div class="topbar-right"><span class="local-badge"><span></span> Local & private</span><button class="icon-button" id="open-command" aria-label="Open command palette" title="Commands (${mod} ⇧ P)"><i data-lucide="command"></i></button><button class="icon-button" id="open-help" aria-label="Help" title="Help"><i data-lucide="help-circle"></i></button><button class="icon-button" id="open-settings" aria-label="Settings" title="Settings"><i data-lucide="settings"></i></button></div></header><div class="workspace"><nav class="rail" aria-label="Note navigation"><button class="rail-button active" id="today" title="Today"><i data-lucide="notebook-pen"></i><span>Today</span></button><button class="rail-button" id="search" title="Search notes"><i data-lucide="search"></i><span>Search</span></button><button class="rail-button" id="history" title="History"><i data-lucide="clock"></i><span>History</span></button><button class="rail-button" id="todos" title="TODOs"><i data-lucide="list-todo"></i><span>TODOs</span></button><button class="rail-button" id="bookmarks" title="Bookmarks"><i data-lucide="bookmark"></i><span>Bookmarks</span></button><div class="rail-spacer"></div><button class="rail-button" id="archive" title="Search archive"><i data-lucide="archive"></i><span>Archive</span></button><button class="rail-button" id="theme" title="Switch appearance" aria-label="Switch appearance"><i data-lucide="sun"></i></button></nav><aside id="search-panel" class="search-panel" hidden></aside><aside id="collections-panel" class="search-panel" hidden></aside><main class="page-area"><div id="preview-banner" class="preview-banner" hidden>Browser preview · use the desktop app to save your notes</div><div id="day-banner" class="day-banner" hidden>A new day is here. <button id="new-day">Open today →</button></div><div class="note-page"><div class="page-meta"><span class="eyebrow" id="day-label">TODAY’S PAGE</span><div class="date-controls"><button class="button" id="format-note" aria-label="Formatting">Aa</button><button class="icon-button small" id="page-bookmarks" aria-label="Bookmark this page" title="Bookmark this page"><i data-lucide="bookmark"></i></button><button class="icon-button small" id="previous-day" aria-label="Previous day"><i data-lucide="arrow-left"></i></button><label class="date-picker" title="Jump to a date"><i data-lucide="calendar-days"></i><input id="date-input" type="date" aria-label="Choose note date"></label><button class="icon-button small" id="next-day" aria-label="Next day"><i data-lucide="arrow-right"></i></button></div></div><h1 id="page-title"></h1><p class="page-subtitle" id="page-subtitle"></p><p id="bookmark-labels" class="muted" hidden></p><div id="archive-banner" class="archive-banner" hidden><i data-lucide="archive"></i>This page is archived.<button id="restore">Restore to notes</button></div><div class="note-rule"><span></span></div><div id="editor"></div><div class="page-hint"><span><i data-lucide="image-plus"></i> Paste an image or drop it here</span><button id="hint-commands">Your tools, one shortcut away <kbd>${mod} ⇧ P</kbd></button></div></div><footer class="statusbar"><button id="save-status" class="save-status" title="Save now / retry"><span class="status-dot"></span><span id="save-label">Ready when you are</span></button><span id="word-count">0 words</span><button id="model-indicator" title="Model and indexing settings"><i data-lucide="sparkles"></i><span>Meaning search</span></button><span class="footer-note">One day at a time.</span></footer></main></div></div><dialog id="palette" class="palette" aria-label="Command palette"></dialog><dialog id="dialog" aria-label="Daily Notes dialog"></dialog><div id="toast" role="status" hidden></div>`;

let info: LibraryInfo = {
  path: null,
  id: null,
  error: null,
  background: false,
  default_folder: "",
  archive_days: 90,
};
let note: Note = {
  day: today(),
  body: "",
  revision: 0,
  archived: false,
  attachments: [],
  updated_at: "",
};
let editVersion = 0,
  savedVersion = 0,
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  maxTimer: ReturnType<typeof setTimeout> | undefined;
let neighbors: [string | null, string | null] = [null, null];
let saving: Promise<void> | null = null,
  pasteTask: Promise<void> | null = null,
  loading = false;
const editor = new NoteEditor($("#editor"), changed, (file) => {
  pasteTask = pasteImage(file)
    .catch((e) => notify(String(e), true))
    .finally(() => (pasteTask = null));
});
editor.reportError = (message) => notify(message, true);
const formats = formattingCommands(editor);
installEditorContextMenu(editor, formats);
localStorage.removeItem("daily-notes-editor");
$("#format-note").onclick = () => showFormatting(editor, formats);
const palette = new Palette($<HTMLDialogElement>("#palette"));
const searchPanel = new SearchPanel(
  $("#search-panel"),
  () => info.id!,
  flush,
  async (hit) => {
    await loadDay(hit.day);
    editor.jump(hit.offset);
  },
);
const collections = new Collections(
  $("#collections-panel"),
  () => info.id!,
  () => note.day,
  flush,
  async (hit) => {
    await loadDay(hit.day);
    editor.jump(hit.offset);
  },
  refreshBookmarkLabels,
);
async function refreshBookmarkLabels() {
  const items = info.id ? await api.bookmarks(note.day, info.id) : [];
  const names = items.filter((b) => b.assigned).map((b) => b.name);
  $("#bookmark-labels").textContent = names.join(" · ");
  $("#bookmark-labels").hidden = names.length === 0;
}
const settings = new Settings({
  info: () => info,
  flush,
  changed: async (value) => {
    searchPanel.close();
    collections.close();
    info = value;
    $<HTMLDialogElement>("#dialog").close();
    await loadDay(today(), true);
  },
  refresh: async () => {
    searchPanel.close();
    collections.close();
    info = await api.info();
    await loadDay(note.day, true);
  },
});
const safe = (fn: () => void | Promise<unknown>) => () => {
  Promise.resolve()
    .then(fn)
    .catch((e) => notify(String(e), true));
};

function changed() {
  editVersion++;
  updateCount();
  setSaveState("Unsaved changes", "pending");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush().catch(() => {}), 1000);
  if (!maxTimer)
    maxTimer = setTimeout(() => void flush().catch(() => {}), 5000);
}
function setSaveState(text: string, state = "saved") {
  $("#save-label").textContent = text;
  $("#save-status").dataset.state = state;
}
function updateCount() {
  const body = editor.snapshot().body;
  $("#word-count").textContent =
    `${body.trim() ? body.trim().split(/\s+/).length : 0} words`;
}
async function flush(): Promise<void> {
  if (pasteTask) await pasteTask;
  if (saving) {
    await saving;
    if (editVersion !== savedVersion) return flush();
    return;
  }
  if (editVersion === savedVersion) return;
  if (!info.id) {
    if (!desktop) {
      setSaveState("Preview · not saved", "pending");
      return;
    }
    throw new Error("Choose a library before writing.");
  }
  clearTimeout(saveTimer);
  clearTimeout(maxTimer);
  maxTimer = undefined;
  const version = editVersion,
    payload = { ...note, ...editor.snapshot() },
    libraryId = info.id;
  setSaveState("Saving…", "pending");
  saving = (async () => {
    try {
      const saved = await api.save(payload, libraryId);
      note = {
        ...note,
        revision: saved.revision,
        archived: saved.archived,
        updated_at: saved.updated_at,
      };
      savedVersion = version;
      if (version === editVersion) setSaveState("All changes saved");
      else setSaveState("Unsaved changes", "pending");
    } catch (e) {
      setSaveState("Save failed · click to retry", "error");
      notify(`Save failed: ${e}. Your draft is still here.`, true);
      throw e;
    } finally {
      saving = null;
    }
  })();
  await saving;
  if (editVersion !== savedVersion) return flush();
}
async function loadDay(day: string, skipFlush = false) {
  if (loading) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  if (!skipFlush) await flush();
  loading = true;
  let loaded = false;
  $<HTMLButtonElement>("#previous-day").disabled = true;
  $<HTMLButtonElement>("#next-day").disabled = true;
  editor.editable(false);
  try {
    const next = info.id
      ? await api.note(day, info.id)
      : {
          ...note,
          day,
          body: "",
          content: null,
          revision: 0,
          attachments: [],
          archived: false,
        };
    const urls = new Map<number, string>();
    for (const id of new Set(next.attachments.map((a) => a.id))) {
      const image = await api.image(id, info.id!);
      urls.set(id, image.url);
    }
    const adjacent = info.id
      ? await api.neighbors(day, next.archived, info.id)
      : ([null, null] as [null, null]);
    note = next;
    neighbors = adjacent;
    editor.load(note, urls, info.id);
    editVersion++;
    savedVersion = editVersion;
    await refreshBookmarkLabels();
    renderDate();
    updateCount();
    setSaveState(note.revision ? "All changes saved" : "Ready when you are");
    loaded = true;
  } finally {
    loading = false;
    editor.editable(loaded && (Boolean(info.id) || !desktop));
    renderDate();
  }
}
function renderDate() {
  $<HTMLButtonElement>("#previous-day").disabled = !neighbors[0];
  $<HTMLButtonElement>("#next-day").disabled = !neighbors[1];
  const isToday = note.day === today();
  $("#day-label").textContent = isToday
    ? "TODAY’S PAGE"
    : "A PAGE FROM YOUR DAYS";
  $("#page-title").textContent = dateLabel(note.day, {
    month: "long",
    day: "numeric",
  });
  $("#page-subtitle").textContent =
    `${dateLabel(note.day, { weekday: "long", year: "numeric" })}  ·  ${isToday ? "Make a little room for your thoughts." : "A thought worth keeping."}`;
  $<HTMLInputElement>("#date-input").value = note.day;
  $("#archive-banner").hidden = !note.archived;
  $("#today").classList.toggle("active", isToday);
  document.title = `${dateLabel(note.day)} — Daily Notes`;
}
async function shiftDay(delta: number) {
  const day = neighbors[delta < 0 ? 0 : 1];
  if (day) await loadDay(day);
}
async function pasteImage(file: File) {
  if (!info.id) throw new Error("Open a desktop library to add images.");
  if (file.size > 25 * 1024 * 1024)
    throw new Error("Images must be smaller than 25 MiB.");
  const libraryId = info.id,
    day = note.day,
    revision = editVersion;
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = await api.addImage(data, libraryId);
  if (libraryId !== info.id || day !== note.day || revision !== editVersion)
    throw new Error(
      "The note changed while loading the image. Please paste again.",
    );
  editor.insertImage(image.id, image.url);
}
async function ensureLibrary() {
  if (!info.id) {
    if (!desktop)
      throw new Error(
        "This is a browser preview. Run npm run desktop for storage and search.",
      );
    await onboarding();
    return false;
  }
  return true;
}
async function onboarding() {
  editor.editable(false);
  const d = showDialog(
    "Make yourself at home.",
    `<div class="welcome-icon"><img src="${icon}" alt="Daily Notes notepad"></div><p class="welcome-copy">A fresh page for every day.<br>Your thoughts, snippets, and screenshots—kept right here, on your device.</p>${info.error ? `<p class="inline-error">${escape(info.error)}</p>` : ""}<div class="welcome-actions"><button id="start-create" class="button primary">Create my library <i data-lucide="arrow-right"></i></button><button id="start-open" class="text-button">Open an existing library</button></div><p class="welcome-footnote">Choose where to save your database. You can move it any time in Settings.</p>`,
  );
  $("#start-create", d).onclick = safe(() => settings.choose(true));
  $("#start-open", d).onclick = safe(() => settings.choose(false));
}
function findInNote() {
  const d = showDialog(
    "Find in this page",
    '<input id="find-note" class="field" placeholder="Find text…" aria-label="Find in note"><p class="muted" id="find-status">Type a word or phrase.</p><div class="actions"><button class="button primary" id="find-next">Find next</button></div>',
  );
  let offset = 0;
  const run = () => {
    const text = $<HTMLInputElement>("#find-note", d).value;
    const body = editor.snapshot().body;
    const index = body.toLowerCase().indexOf(text.toLowerCase(), offset);
    const found =
      index >= 0 ? index : body.toLowerCase().indexOf(text.toLowerCase());
    if (text && found >= 0) {
      editor.jump(found, text.length);
      offset = found + text.length;
      $("#find-status", d).textContent = "Match selected in your note.";
    } else $("#find-status", d).textContent = "No match found.";
  };
  $("#find-next", d).onclick = run;
  $("#find-note", d).onkeydown = (e) => {
    if (e.key === "Enter") run();
  };
}
const commands: Command[] = [
  {
    id: "today",
    title: "Go to today",
    description: "Open today’s page",
    group: "Navigate",
    shortcut: `${mod} T`,
    run: () => loadDay(today()),
  },
  {
    id: "search",
    title: "Search notes",
    description: "Find words and related ideas",
    group: "Navigate",
    shortcut: `${mod} ⇧ F`,
    run: async () => {
      if (await ensureLibrary()) {
        collections.close();
        await searchPanel.open();
      }
    },
  },
  {
    id: "history",
    title: "History",
    description: "Browse your daily pages",
    group: "Navigate",
    run: async () => {
      if (await ensureLibrary()) {
        collections.close();
        await searchPanel.open(false, true);
      }
    },
  },
  {
    id: "archive-search",
    title: "Search archive",
    description: "Find your archived pages",
    group: "Navigate",
    run: async () => {
      if (await ensureLibrary()) {
        collections.close();
        await searchPanel.open(true);
      }
    },
  },
  {
    id: "todos",
    title: "TODOs",
    description: "Glance at #todo lines from the last 7 days",
    group: "Navigate",
    run: async () => {
      if (await ensureLibrary()) {
        searchPanel.close();
        await collections.open("todos");
      }
    },
  },
  {
    id: "bookmarks",
    title: "Bookmarks",
    description: "Browse pages by named bookmark",
    group: "Navigate",
    run: async () => {
      if (await ensureLibrary()) {
        searchPanel.close();
        await collections.open("bookmarks");
      }
    },
  },
  {
    id: "bookmark-page",
    title: "Bookmark this page",
    description: "Create and assign one or more bookmarks",
    group: "Navigate",
    run: async () => {
      if (await ensureLibrary()) await collections.edit();
    },
  },
  ...formats,
  ...toolCommands(editor, () => editVersion),
  {
    id: "settings",
    title: "Settings & storage",
    description: "Library location, backups, and background behavior",
    group: "Settings",
    run: async () => {
      if (await ensureLibrary()) await settings.show();
    },
  },
  {
    id: "backup",
    title: "Back up now",
    description: "Create a verified copy of your library",
    group: "Settings",
    run: async () => {
      if (await ensureLibrary()) await settings.backup();
    },
  },
  {
    id: "archive-old",
    title: "Archive older notes",
    description: "Default: notes older than 90 days",
    group: "Settings",
    run: async () => {
      if (await ensureLibrary()) await settings.archive();
    },
  },
  {
    id: "export",
    title: "Export current draft",
    description: "Emergency export of text and images to a folder",
    group: "Settings",
    run: async () => {
      if (!info.id) return;
      const folder = await open({
        directory: true,
        title: "Export draft to folder",
      });
      if (typeof folder === "string") {
        await api.export(folder, { ...note, ...editor.snapshot() }, info.id);
        notify("Draft exported.");
      }
    },
  },
  {
    id: "help",
    title: "Help",
    description: "Get to know Daily Notes",
    group: "Help",
    run: () => showHelp("help", commands),
  },
  {
    id: "guide",
    title: "User Guide",
    description: "Read about features and workflows, offline",
    aliases: "docs manual readme documentation",
    group: "Help",
    run: () => showHelp("guide", commands),
  },
  {
    id: "shortcuts",
    title: "Keyboard Shortcuts",
    description: "Less clicking, more flow",
    group: "Help",
    run: () => showHelp("shortcuts", commands),
  },
];
palette.set(commands);
const execute = (id: string) =>
  safe(() => commands.find((c) => c.id === id)!.run());
$("#today").onclick = execute("today");
$("#brand").onclick = execute("today");
$("#new-day").onclick = safe(async () => {
  await loadDay(today());
  $("#day-banner").hidden = true;
});
$("#search").onclick = execute("search");
$("#history").onclick = execute("history");
$("#todos").onclick = execute("todos");
$("#bookmarks").onclick = execute("bookmarks");
$("#page-bookmarks").onclick = execute("bookmark-page");
$("#archive").onclick = execute("archive-search");
$("#open-help").onclick = execute("help");
$("#open-settings").onclick = execute("settings");
$("#model-indicator").onclick = execute("settings");
$("#open-command").onclick = () => palette.open();
$("#hint-commands").onclick = () => palette.open();
$("#save-status").onclick = safe(flush);
$("#previous-day").onclick = safe(() => shiftDay(-1));
$("#next-day").onclick = safe(() => shiftDay(1));
$<HTMLInputElement>("#date-input").onchange = safe(() =>
  loadDay($<HTMLInputElement>("#date-input").value),
);
$("#restore").onclick = safe(async () => {
  await flush();
  await api.restore(note.day, info.id!);
  searchPanel.close();
  collections.close();
  await loadDay(note.day, true);
  notify("Page restored. Use All time to find older pages.");
});
let dark = localStorage.getItem("daily-notes-theme") === "dark";
const applyTheme = () => {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#theme").innerHTML = `<i data-lucide="${dark ? "moon" : "sun"}"></i>`;
  icons();
};
applyTheme();
$("#theme").onclick = () => {
  dark = !dark;
  localStorage.setItem("daily-notes-theme", dark ? "dark" : "light");
  applyTheme();
};
document.addEventListener("keydown", (e) => {
  const command = e.metaKey || e.ctrlKey;
  if (command && e.shiftKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    if (!$<HTMLDialogElement>("#palette").open) palette.open();
  } else if (command && e.shiftKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    execute("search")();
  } else if (command && e.key.toLowerCase() === "s") {
    e.preventDefault();
    safe(flush)();
  } else if (command && e.key.toLowerCase() === "t") {
    e.preventDefault();
    execute("today")();
  } else if (command && e.key.toLowerCase() === "f") {
    e.preventDefault();
    findInNote();
  } else if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
    searchPanel.close();
    collections.close();
    editor.focus();
  }
});
document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
  if (a) {
    e.preventDefault();
    if (a.closest(".tiptap") && !e.metaKey && !e.ctrlKey) return;
    const url = a.getAttribute("href") ?? "";
    if (/^(https?:\/\/|mailto:)/i.test(url))
      void openUrl(url).catch((err) => notify(String(err), true));
  }
});
function modelStatus(status: ModelStatus) {
  const label =
    status.state === "downloading"
      ? `Downloading model ${Math.round(status.progress * 100)}%`
      : status.state === "indexing"
        ? "Updating meaning search"
        : status.state === "ready"
          ? "Meaning search ready"
          : status.state === "unavailable"
            ? "Meaning search offline"
            : "Preparing meaning search";
  $("#model-indicator span").textContent = label;
  $("#model-indicator").title = status.message;
}
let knownDay = today();
function checkDay() {
  if (today() !== knownDay) {
    knownDay = today();
    $("#day-banner").hidden = false;
  }
}
const midnight = new Date();
midnight.setHours(24, 0, 0, 0);
setTimeout(checkDay, midnight.getTime() - Date.now() + 100);
window.addEventListener("focus", checkDay);
window.addEventListener("blur", () => void flush().catch(() => {}));
async function close(quit: boolean) {
  try {
    await flush();
    await api.close(quit);
  } catch {
    const d = showDialog(
      "Your draft has not been saved",
      '<p>Saving failed. Keep this window open, retry saving, or export the draft from the command palette before quitting.</p><button id="retry-save" class="button primary">Retry saving</button>',
    );
    $("#retry-save", d).onclick = safe(async () => {
      await flush();
      d.close();
    });
  }
}
async function start() {
  renderDate();
  icons();
  if (!desktop) {
    $("#preview-banner").hidden = false;
    return;
  }
  info = await api.info();
  await listen<ModelStatus>("model-status", (event) =>
    modelStatus(event.payload),
  );
  await listen("request-quit", () => void close(true));
  await listen("request-hide", () => {
    void flush()
      .then(() => api.hide())
      .catch((e) =>
        notify(`Could not hide: ${e}. Your draft is still here.`, true),
      );
  });
  await listen("focus-editor", () => {
    if (!document.querySelector("dialog[open]")) editor.focus();
  });
  await getCurrentWindow().onCloseRequested((e) => {
    e.preventDefault();
    void close(false);
  });
  modelStatus(await api.model());
  if (info.id) await loadDay(today(), true);
  else await onboarding();
}
void start().catch((e) => notify(String(e), true));
