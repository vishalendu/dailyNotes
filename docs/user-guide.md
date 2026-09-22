# Daily Notes User Guide

User guide for version 0.1.

## Getting started

On first launch, choose a folder for your library or open an existing library. Each library is a SQLite database containing notes, images, and search data. The app remembers your selection and opens today's page on subsequent launches.

Type freely or paste an image at the cursor. Each calendar date has one page. History stays hidden until you open it; Today returns to the current date. At a day change, active typing is never redirected into a different note.

The arrows move between saved notes, skipping dates without a note. An arrow is disabled when there is no earlier or later note in the current collection (active or archived). Use the calendar to open any date, or Today to start today's page.

## Fonts and compact spacing

Open **Aa** beside the date controls. Select text, choose **Font** and **Size**, preview, then **Apply to selection**. Only that text changes. With a cursor and no selection, your next typing uses the chosen style. Select all to format the current note; code retains its monospace styling. Different selections and different notes can have different fonts. The controls show **Mixed** when a selection contains different styles; opening Aa alone changes nothing.

**Line spacing** and **Paragraph spacing** affect the paragraphs/headings touched by the selection, or the current paragraph. They do not remove deliberate blank lines. Size ranges from 12–24px, line height from 1.0–2.0, and paragraph spacing is 0/4/8/12px. Unstyled text defaults to system sans-serif, 14px, line height 1.4, and zero extra spacing. Typography is saved with the note and supports undo/redo. **Clear formatting** removes selected styling without deleting text or images.

The Font dropdown includes portable sans-serif/serif/monospace choices and fonts installed on this computer. Reopen Aa to refresh the installed list. Font discovery errors leave generic choices available. If you move the library to a computer without a chosen font, text falls back to the default system sans-serif; its original font name, size, and other formatting remain saved. Installing that font restores its appearance. No fonts are downloaded or embedded.

Known symbol fonts such as Wingdings/Webdings are excluded from new font choices. Imported content using a missing symbol font shows a warning: fallback may change the meaning of its characters. Use Unicode symbols or paste an image for portable symbols. Original characters are preserved; the app cannot identify every custom symbol encoding.

The former global Editor appearance setting has been removed. Its old machine-local preferences no longer affect notes; unstyled content returns to the compact defaults. Stored rich formatting is preserved, and notes are not rewritten merely by opening them.

## Formatting and Markdown shortcuts

Use the **Aa** button beside the date, or command-palette actions for Bold, Italic, Strikethrough, Inline code, Heading 1–3, Bullet list, Numbered list, Blockquote, Code block, and Add or edit link. Cmd/Ctrl+B and Cmd/Ctrl+I toggle bold and italic. Clear formatting removes styling from the selected content while keeping text and images.

Markdown typing shortcuts format directly in the editor: type `# ` for a heading, `- ` for a bullet list, `1. ` for a numbered list, `> ` for a quote, or a triple-backtick fence followed by space/Enter for a code block. Inline markers such as `**bold**`, `*italic*`, and backticks format while typing. Edit the formatted result directly; there is no separate Markdown preview pane. `#todo` and `#TODO` remain literal tags, since they have no space after the hash.

Pasted plain text and existing notes are not automatically interpreted as Markdown. Select a pasted Markdown passage and choose **Convert selection from Markdown** when you want conversion. Basic formatting is supported; tables, syntax highlighting, executable code, and arbitrary HTML/CSS editing are not included.

Enter makes a paragraph or list item; Shift+Enter inserts a line break. Inside a list, Tab and Shift+Tab indent/outdent. Code blocks preserve indentation and line breaks; Tab inserts two spaces, and long lines scroll horizontally. Use Cmd/Ctrl+Enter to exit a code block. JSON tools applied inside a code block keep it as code, and Undo restores a transformation in one step. Cmd/Ctrl-click a link to open it externally; ordinary clicking lets you edit its text.

## Pasting with or without formatting

- **Normal paste (Cmd/Ctrl+V):** keeps supported semantic formatting and validated font/size styles from HTML, while normalizing source margins and line spacing to compact defaults. Unsafe content and remote images are removed. Image-only clipboard data continues through the normal image importer.
- **Paste without formatting:** Cmd+Shift+V on macOS or Ctrl+Shift+V on Windows/Linux, the editor's right-click menu, or the command palette. It removes styling—including inherited bold/italic at the insertion point—while preserving line breaks, indentation, and blank lines. Windows/Linux native shortcuts still need platform testing.
- **Paste inside code:** always inserts literal text. HTML and Markdown markers are not interpreted.
- **Clear formatting:** fixes text that is already in a note.

Line endings are normalized to LF. Clipboard text is read only when you ask to paste. If clipboard access fails, the note is left unchanged. Copying formatted text and images between pages in the same open library preserves them. After switching libraries or restarting, embedded HTML image IDs are not trusted; paste the original image file/clipboard image again if needed. External HTML images are not downloaded.

Formatting is saved inside your SQLite database. Existing notes remain unchanged until you edit them. Before the v4 storage upgrade, a verified `pre-v4` backup is kept beside the library. Emergency draft export includes `.txt`, structured `.json`, and image files so rich content is recoverable as well as readable. Old app binaries cannot open the upgraded library.

## Finding commands and help

Press **Cmd+Shift+P on macOS** or **Ctrl+Shift+P on Windows/Linux** to open the command palette. You can also use the command button. Type an action such as “format JSON,” “search archive,” “backup,” or “settings,” then select it with the arrow keys and Enter.

Type **Help** for a quick orientation, **User Guide** for this document, or **Keyboard Shortcuts** for platform-specific shortcuts. “Docs,” “manual,” and “readme” also find the guide. The visible **?** button opens Help directly. Escape closes the panel and returns to your writing. Help and the guide work offline.

## Global show/hide shortcut

While Daily Notes is running, press **Ctrl+Alt+Space** on Windows/Linux or **Control+Option+Space** on macOS from any application to bring the notes window forward. Press it again while Daily Notes is focused to save pending edits and hide the window. Hiding keeps the app running; it does not quit. If saving fails, the window stays open with the draft intact.

Change the combination in **Settings → Quick capture shortcut**, then choose Save shortcut. Use names such as `Control+Alt+Space` or `Control+Shift+N`; on Mac, Alt means Option and Super means Command. Leave the field blank to disable the shortcut. Settings shows registration failures, including conflicts with another application's shortcut. An invalid or unavailable replacement leaves the previous shortcut in place.

Quit stops the app and its shortcut. To keep it available after closing the window with the close button, enable **Keep running in background**. Launch-at-login is not configured by this version. Global shortcuts work on macOS, Windows, and Linux/X11; the current [shortcut library does not support Wayland](https://github.com/tauri-apps/global-hotkey#platforms-supported). On Wayland, use your desktop's shortcut settings to launch or activate Daily Notes instead.

## Saving and background work

Notes save after about one second without typing, and at least every five seconds during continuous editing. Navigating away, hiding the window, or quitting flushes pending edits. Cmd/Ctrl+S saves immediately. The Saved indicator means the latest edits committed successfully; if saving fails, keep the app open and use Retry or emergency export.

Semantic indexing is separate: changed saved notes are processed in batches approximately every 10 minutes. This avoids loading the embedding model for every save. A crash can still lose edits made since the last completed save.

Enable background running in Settings to keep the app available through the tray/menu bar after closing the window. It is disabled by default. Quit exits fully. The app performs no inference when there is no pending indexing or semantic query.

## Searching notes

Use Search or Cmd/Ctrl+Shift+F. Results show a note's date and a short matching passage. Open a result to view the note; meaning matches jump to the indexed passage. The first page contains up to 20 unique notes; Load more adds another 20.

- **Combined search:** finds exact words and related meanings.
- **Keywords:** useful for identifiers, errors, and filenames. Multiple words must all occur; a trailing `*` searches word prefixes.
- **Meaning:** useful for descriptions such as “problems deploying the app,” even when the note uses different wording.

Choose Last 7, 30, or 90 days, a custom number of days, or All time. Normal search starts with Last 30 days. Relative ranges include today and use the note's date, not when it was last edited. Best match prioritizes relevance; Newest first orders retrieved matches by date.

Keyword results reflect saved edits immediately. Meaning search can lag until the next indexing batch; pending updates are indicated. Search does not read text inside images. Cmd/Ctrl+F finds text within the current page.

## TODOs at a glance

Add `#todo` or `#TODO` anywhere on a task's line, for example `#TODO Review the deployment logs` or `Call the supplier #todo`. Tags are case-insensitive; `todo` without the hash and `#todoLater` do not count. Each tagged line appears once, with its page date, in **TODOs** in the sidebar or command palette.

The view starts with the **last 7 days, including today**, newest first. Change Last days to any positive number, or clear it for all time. Search within the tagged lines using the text filter. Click a result to jump to that line in its daily page. Saved edits appear when you reopen or filter the view; no embedding model is needed. Remove the tag when you no longer want the line listed. This is a view of tagged notes, not a separate task database or checkbox system.

Active notes are shown by default. Choose Archive only to find TODOs in archived pages. Date ranges use the page date, not the date on which you added the tag. Results load in batches of 100 lines.

## Bookmarks

Click the bookmark icon beside a page's date controls, or choose **Bookmark this page** in the command palette. Create a named bookmark such as Work, Ideas, or Project Alpha, select one or more checkboxes, then **Apply bookmarks**. The selected names appear below the date. Uncheck a bookmark and apply to remove it from that page. Bookmarks can also be assigned to an empty page.

Open **Bookmarks** in the sidebar or palette to browse all bookmarked pages, or filter to a particular bookmark. A page may belong to multiple bookmarks; each page appears once in results. The view starts with all dates and active notes. You can filter by recent days, page text, or Archive only. Bookmarks stay with their library, including backups and moves.

Creating a bookmark saves its name immediately; Apply saves the page assignments. Closing the dialog without applying leaves page assignments unchanged. Existing libraries are upgraded automatically on opening to store bookmarks in SQLite alongside the notes. A `pre-v2` SQLite backup is kept beside the original library before upgrading.

## Archiving and restoring

Open Archive older notes from the palette or Storage settings. The age defaults to **older than 90 days**. Review the cutoff and eligible count, then choose Archive now. Archiving is manual, not an automatic deletion policy.

Archived notes disappear from normal history and search. **Search archive** searches only archived notes and initially uses All time. All time in normal search still excludes the archive.

Archived notes remain readable and editable. Use Restore to notes to return one to the active collection. An old restored note may require All time to appear in active search. Archiving keeps notes in the same database and does not shrink the file or replace a backup.

## Developer text tools

Select text, open the palette, and choose a tool. Initial tools include JSON formatting/minifying/validation/key sorting, Base64 and URL encoding/decoding, HTML entities, case conversion, line sorting/deduplication, counts, JWT inspection, timestamp conversion, SHA-256, and UUID generation.

With no selection, a transforming tool asks you to choose Use entire note. Select text only when the note includes images. Each transformation can be undone in one step. A text tool replaces its selected rich content with plain output; surrounding formatting stays intact. Within a code block, it replaces code text without removing the block. Invalid input leaves the note unchanged. Inspection tools show a result panel with Copy instead of replacing your text. JWT decoding displays contents but does not verify the signature.

These tools work locally and do not need the embedding model.

## The local embedding model

At startup the app checks whether its model files are present and downloads missing files in the background. Notes and keyword search remain usable during download or while offline. After download, semantic search runs locally; your notes and queries are not uploaded.

The model loads for indexing or a meaning-based query. It unloads after an indexing batch, or after about 60 seconds without a semantic query. Disk storage and memory usage are different; unloading releases the inference session, though the operating system may retain some memory temporarily.

This version uses all-MiniLM-L6-v2 with 384-dimensional embeddings. Model and tokenizer files use about 91 MB on disk and are stored outside your Git repository.

## Storage and backups

Storage settings show the active library folder. Move library safely copies and verifies the database before switching, retaining the original as a recovery copy. Open existing library switches libraries without merging them. Model files are stored separately in application data and do not move with the notes library.

Use **Back up now** to create a consistent SQLite snapshot containing active notes, archived notes, and images. Do not copy only the main database file while the app is open: live SQLite operation can use companion WAL files. Keep recovery copies on a separate device if you need protection from disk failure.

Use local storage or a locally attached drive for the live library. A network share or concurrently cloud-synced live database is unsupported. If the folder becomes unavailable, reconnect it or choose another library; the app does not silently replace it with an empty database.

## Troubleshooting

- **Save failed:** check free disk space and folder access, then retry. Export the draft before quitting if the error persists.
- **Meaning search unavailable:** finish or retry the model download; keyword search continues to work.
- **Missing recent meaning matches:** check pending indexing status; saved keyword results are available immediately.
- **An older note is missing:** expand the date range, then use Search archive if necessary.
- **Window closed but app still running:** reopen it from the tray/menu bar, or use Quit to stop it.
