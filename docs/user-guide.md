# Daily Notes User Guide

User guide for version 0.1.

## Getting started

On first launch, choose a folder for your library or open an existing library. Each library is a SQLite database containing notes, images, and search data. The app remembers your selection and opens today's page on subsequent launches.

Type freely or paste an image at the cursor. Each calendar date has one page. History stays hidden until you open it; Today returns to the current date. At a day change, active typing is never redirected into a different note.

The arrows move between saved notes, skipping dates without a note. An arrow is disabled when there is no earlier or later note in the current collection (active or archived). Use the calendar to open any date, or Today to start today's page.

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

With no selection, a transforming tool asks you to choose Use entire note. Select text only when the note includes images. Each transformation can be undone in one step. Invalid input leaves the note unchanged. Inspection tools show a result panel with Copy instead of replacing your text. JWT decoding displays contents but does not verify the signature.

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
