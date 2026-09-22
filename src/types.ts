import type { JSONContent } from "@tiptap/core";
export interface Attachment {
  offset: number;
  id: number;
}
export interface Bookmark {
  id: number;
  name: string;
  assigned: boolean;
}
export interface HotkeyStatus {
  shortcut: string;
  registered: boolean;
  error: string | null;
}
export interface CollectionSearch {
  kind: "todos" | "bookmarks";
  query: string;
  days: number | null;
  archived: boolean;
  bookmark_id: number | null;
  limit: number;
}
export interface Note {
  content?: JSONContent | null;
  day: string;
  body: string;
  revision: number;
  archived: boolean;
  attachments: Attachment[];
  updated_at: string;
}
export interface LibraryInfo {
  path: string | null;
  id: string | null;
  error: string | null;
  background: boolean;
  default_folder: string;
  archive_days: number;
}
export interface Hit {
  day: string;
  snippet: string;
  archived: boolean;
  score: number;
  offset: number;
}
export interface SearchOptions {
  query: string;
  archived: boolean;
  days: number | null;
  mode: "keywords" | "meaning" | "combined";
  newest: boolean;
  limit: number;
}
export interface ModelStatus {
  state: string;
  message: string;
  progress: number;
  loaded: boolean;
}
export interface Stats {
  active: number;
  archived: number;
  pending: number;
  bytes: number;
}
export interface ImageResult {
  id: number;
  url: string;
  width: number;
  height: number;
}
export interface Command {
  id: string;
  title: string;
  description: string;
  group: string;
  aliases?: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}
