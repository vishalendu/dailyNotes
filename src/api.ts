import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Note,
  LibraryInfo,
  SearchOptions,
  Hit,
  ImageResult,
  ModelStatus,
  Stats,
  Bookmark,
  CollectionSearch,
  HotkeyStatus,
} from "./types";
export const desktop = isTauri();
export const api = {
  installedFonts: () => invoke<string[]>("installed_fonts"),
  clipboardText: () => invoke<string>("clipboard_text"),
  hotkey: () => invoke<HotkeyStatus>("hotkey_status"),
  setHotkey: (shortcut: string) =>
    invoke<HotkeyStatus>("set_hotkey", { shortcut }),
  hide: () => invoke<void>("hide_window"),
  bookmarks: (day: string, libraryId: string) =>
    invoke<Bookmark[]>("bookmarks", { day, libraryId }),
  createBookmark: (name: string, libraryId: string) =>
    invoke<number>("create_bookmark", { name, libraryId }),
  assignBookmarks: (day: string, ids: number[], libraryId: string) =>
    invoke<void>("assign_bookmarks", { day, ids, libraryId }),
  collectionHits: (search: CollectionSearch, libraryId: string) =>
    invoke<Hit[]>("collection_hits", { search, libraryId }),
  info: () => invoke<LibraryInfo>("library_info"),
  choose: (path: string, create: boolean) =>
    invoke<LibraryInfo>("choose_library", { path, create }),
  note: (day: string, libraryId: string) =>
    invoke<Note>("get_note", { day, libraryId }),
  neighbors: (day: string, archived: boolean, libraryId: string) =>
    invoke<[string | null, string | null]>("note_neighbors", {
      day,
      archived,
      libraryId,
    }),
  save: (note: Note, libraryId: string) =>
    invoke<Note>("save_note", { note, libraryId }),
  search: (search: SearchOptions, libraryId: string) =>
    invoke<Hit[]>("search_notes", { search, libraryId }),
  image: (id: number, libraryId: string) =>
    invoke<ImageResult>("get_image", { id, libraryId }),
  addImage: (data: string, libraryId: string) =>
    invoke<ImageResult>("add_image", { data, libraryId }),
  stats: () => invoke<Stats>("library_stats"),
  archive: (days: number, preview: boolean, libraryId: string) =>
    invoke<number>("archive_notes", { days, preview, libraryId }),
  restore: (day: string, libraryId: string) =>
    invoke("restore_note", { day, libraryId }),
  backup: (path: string, libraryId: string) =>
    invoke("backup_library", { path, libraryId }),
  move: (folder: string, libraryId: string) =>
    invoke<LibraryInfo>("move_library", { folder, libraryId }),
  background: (enabled: boolean) => invoke("set_background", { enabled }),
  model: () => invoke<ModelStatus>("model_status"),
  modelAction: (action: string) => invoke("model_action", { action }),
  close: (quit: boolean) => invoke("finish_close", { quit }),
  export: (folder: string, note: Note, libraryId: string) =>
    invoke("export_note", { folder, note, libraryId }),
};
