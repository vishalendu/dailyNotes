# Editor usability and formatting plan

**Superseding plan:** [Selection-based formatting under Aa](selection-formatting-plan.md) replaces the global typography approach and the deferral of per-word fonts below. That follow-up is implemented; this document records the earlier delivery.

Status: implemented, 2026-09-22. This document retains the original delivery plan; README, User Guide, and the rich-editor section of spec.md describe shipped behavior. Basic browser/Rust checks cover the core flows; Windows/Linux native clipboard validation remains pending. Implementation uses installation-local appearance preferences and omits external HTML images rather than fetching them.

## Outcome

Make Daily Notes comfortable for ordinary writing and dense technical snippets: adjustable typography, predictable paste behavior, basic rich formatting, and code blocks. Keep SQLite storage, offline operation, pasted images, search, TODOs, bookmarks, and the lightweight command-palette UI.

## Findings in the current implementation

- `src/styles.css` fixes the editor at 14px monospace, line-height 1.95, paragraph min-height 1.95em, and 7px bottom margins. At 14px, each single-line paragraph occupies roughly 34px. This explains much of the wasted vertical space.
- `src/document.ts` turns every pasted newline into a paragraph. The paragraph margin compounds the line spacing; the problem is not necessarily formatting from the source application.
- `src/editor.ts` currently intercepts paste and uses `text/plain`, discarding external formatting. There is no separate normal/plain paste choice.
- Tiptap StarterKit is already installed, but bold, italic, headings, lists, inline code, code blocks, quotes, and links are explicitly disabled.
- The serializer persists plain text and image offsets only. Enabling rich editing alone would lose formatting on the next reload. Its text extraction and cursor mapping also assume top-level paragraphs rather than nested lists and quotes.

## 1. Typography and spacing

Add an Editor appearance section in Settings, with live preview and Reset defaults:

| Control | Proposed default | Choices |
| --- | --- | --- |
| Body font | System sans-serif | System sans-serif, serif, monospace; optional custom font-family name |
| Body font size | 14px | 12–24px |
| Line height | 1.4 | 1.0–2.0 in 0.1 steps |
| Paragraph spacing | 0px | 0, 4, 8, 12px |
| Code font | System monospace | Monospace fallback stack |

Use CSS custom properties for all paragraph/list spacing, including the empty paragraph minimum height. Changing line-height alone must not leave the old 1.95em minimum in place. A compact default single-line paragraph should occupy about 20px rather than 34px.

These are application-wide display preferences, saved separately from library content. They apply to existing pages immediately, survive restart, and do not mark a note dirty or trigger indexing. Keep the same preferences in both themes. Font selection changes the reading/writing appearance, not individual words' persisted font families. Custom fonts use locally installed fonts with a reliable fallback; no font downloads or OS-specific font enumeration are required.

Keep actual blank lines, tabs, and indentation intact. Offer an explicit existing text-tool action to remove unwanted empty lines; do not silently collapse them during paste or when changing spacing. Code blocks use compact monospace styling, preserve whitespace, and scroll horizontally for long lines.

## 2. Basic formatting

Reuse the installed Tiptap extensions. Support:

- Bold, italic, strikethrough, and inline code.
- Headings H1–H3 and normal paragraphs.
- Bulleted and numbered lists, including nested list indentation.
- Blockquotes and fenced code blocks.
- Safe links and existing inline images.
- Clear formatting on the selection, keeping its text and image references.

Use a small Formatting button beside the editor's date controls, plus command-palette entries and keyboard shortcuts. Keep the toolbar compact; avoid a permanent word-processor ribbon. Show the current block type and active marks when the formatting menu is open. Preserve selection when opening a menu or palette, and restore editor focus after applying an action.

Enable Markdown-style typing shortcuts: `# `, `## `, `### `, `- `, `1. `, `> `, backtick fences for a code block, and basic inline markers. These are editing shortcuts, not a switch to Markdown-file storage. `#todo` and `#TODO` remain literal searchable tags; they must not become headings.

Normal Enter creates a paragraph or list item. Shift+Enter inserts a line break. Inside code blocks, Enter inserts a literal newline and Tab inserts indentation. Inside lists, Tab/Shift+Tab change nesting instead of using the current unconditional two-space Tab handler. Use the editor's native undo/redo and code-block exit behavior, and document it.

Provide an explicit **Convert selection from Markdown** command for pasted Markdown. Normal plain-text paste must not unexpectedly reinterpret code, hashes, or underscores as formatting. Use the existing Markdown parser and sanitizer, then the supported editor schema; do not introduce a second editor or a live HTML source view.

Defer tables, per-word fonts/colors, arbitrary HTML/CSS editing, executable code cells, and syntax highlighting. The first version of code blocks is styled, editable plain code; it does not run code.

## 3. Predictable clipboard behavior

| Action | Behavior |
| --- | --- |
| Normal paste | Preserve supported semantic formatting from HTML; otherwise insert plain text. Use the app's font and spacing. |
| Paste without formatting | Insert only clipboard text with its newlines and indentation, without marks or Markdown conversion. |
| Paste inside code | Insert literal plain text, retaining tabs and line breaks. |
| Paste an image | Continue saving image bytes in SQLite through the existing image pipeline. |
| Clear formatting | Remove supported marks/block styling from the selection, preserving text and images. |

Expose Paste without formatting through a standard editing shortcut (target Cmd/Ctrl+Shift+V), the editor's context menu, and the command palette. Validate the shortcut on each native webview; expose the action visibly even where the OS uses another shortcut. Prefer the clipboard event's text data for keyboard paste. A palette/context-menu action may use a narrowly scoped Tauri clipboard text reader if the webview cannot supply clipboard text there; report denied/unavailable access without changing the note.

Normalize CRLF/CR to LF, but retain blank lines, indentation, Unicode, and leading/trailing spaces. Plain paste explicitly clears inherited marks for the inserted content; it is not enough merely to discard clipboard HTML while retaining bold from the insertion position.

For formatted paste, sanitize HTML and import only supported semantic nodes and marks. Strip fonts, sizes, line spacing, margins, colors, classes, styles, scripts, event handlers, iframes, and unsupported elements. Allow safe link schemes, with links opened externally rather than navigating the app. The same rules apply to explicit Markdown conversion, including embedded raw HTML.

Do not fetch remote images in pasted HTML. Retain useful alternative text for unsupported/remote images; import actual clipboard image data through the existing validated image handler. HTML supplied by another application must never be trusted to name an internal database image ID. Preserve internal image references only through a validated app-origin clipboard path, with a safe text/image fallback for cross-library copies.

A normal HTML paste should insert the whole supported fragment rather than accidentally choosing a clipboard thumbnail file and discarding all the text. Keep a dedicated image-only clipboard path. Each paste/conversion is one undoable action; asynchronous image ingestion must preserve the existing stale-edit checks.

## 4. Persist formatting in SQLite

Introduce schema version 3 after a verified backup. Add nullable `content_blob` and a document-format/codec version to each note:

- Store the canonical, restricted Tiptap document as compressed JSON in the BLOB. Use a standard gzip codec with an explicit version, not base64 or image bytes embedded in JSON. Add a direct Rust compression dependency only for this codec; retain bounded decompression.
- Keep `notes.body` as a derived plain-text projection for FTS5, semantic indexing, TODO extraction, snippets, word counts, and recovery export. This intentionally duplicates searchable text; compression limits the extra cost of the structured document. Measure representative library size during implementation.
- Keep actual image bytes in `images`. Document image nodes contain validated database image IDs, not transient data URLs. Rebuild display URLs on load. Retain `note_images` as the transactional reference/offset mapping.
- Save document content, projection, image references, revision, and indexing state atomically. Validate supported node/mark types, attributes, safe link URLs, node depth/count, size limits, and image ownership at the Rust boundary. Reject malformed/unsupported documents without overwriting the previous note.
- Rust derives or verifies the text projection and attachment positions from the validated document rather than trusting unrelated client-supplied text and image offsets. Frontend and backend traversal use shared test fixtures.

Legacy rows with no document BLOB load through the existing paragraph-and-image reconstruction. On the first actual edit, save structured content. Do not auto-interpret old text as Markdown: existing JSON, code, hashes, and literal markup must remain unchanged. Avoid rewriting every note or embedding on first launch.

Formatting changes increment the note revision for conflict detection. If the derived text is unchanged, preserve existing semantic vectors and update their revision consistently in the same transaction; retain any already-pending text indexing. Text changes follow the normal immediate keyword update and delayed embedding workflow. Do not skip revision validation in in-flight embedding jobs.

Keep the existing 5 MiB plain-text limit. Establish a separate bounded decompressed-document limit (initial target 10 MiB), a node-count cap, and a nesting-depth cap; validate before allocation-heavy processing. Unsupported document versions or decompression failures must show a recoverable error, never silently flatten and overwrite the note. Emergency export should include the current structured draft and a readable text copy plus images.

The old application rejects the newer schema. Keep the pre-upgrade backup available for rollback; do not advertise reopening the upgraded library in an older binary.

## 5. Preserve existing workflows

- Replace paragraph-only extraction with a canonical traversal of paragraphs, headings, list items, quotes, code blocks, hard breaks, and images. Specify separators so adjacent list items cannot become one word or one TODO line. List bullets/numbers are presentation, not extra searchable text.
- Build a projection-to-editor-position map from that same traversal. Search and TODO hits use UTF-16 offsets and must still jump to the correct passage inside lists, code, and quotes, including after emoji or images.
- A TODO tag in a formatted line remains searchable; preserve the existing rule for tags appearing inside code rather than introducing an unrequested exclusion.
- Bookmarks remain attached to dates, independently of document formatting.
- Text tools operate on plain selected text. Within a code block, JSON formatting replaces code text while preserving the block. Across rich blocks, replace only the chosen range and keep surrounding formatting/images. Explain that transforming a rich selection replaces that selection with plain output; reuse the whole-note confirmation for whole-page transformations.
- Formatting, paste, and Markdown conversion participate in one-step undo and durable autosave. Merely changing appearance does not. Background hide/quit continues to flush pending structured edits.
- Preserve light/dark contrast for code, quotes, links, selection, and formatting controls. Preserve accessible names, keyboard navigation, and visible focus.

## 6. Delivery order

1. **Compact spacing and appearance controls.** Fix CSS defaults first, add font/size/line/paragraph controls, persist preferences, and verify existing notes and paste spacing. This can ship independently without a database migration.
2. **Structured persistence and compatibility.** Define the document schema/projection, add backup and migration, implement bounded compression and transactional validation, then verify legacy text/images and rich-document round trips. Keep new formatting controls hidden until this works.
3. **Formatting and code blocks.** Enable the supported extensions, compact menu/palette actions, Markdown typing shortcuts, clear formatting, and context-aware Enter/Tab. Update text-tool replacement and search/TODO position mapping.
4. **Clipboard modes.** Add safe formatted paste, explicit plain paste, Markdown conversion, and native-webview shortcut checks. Verify image handling and undo.
5. **Documentation and release checks.** Update Help, User Guide, shortcuts, README, and the main spec to describe implemented behavior. Package only after persistence, compatibility, and paste checks pass.

## 7. Basic acceptance checks

- A pasted three-line snippet uses the configured line height with no unintended blank lines; font/spacing preferences persist after restart without creating a note revision.
- Intentional blank lines, indentation, CRLF input, emoji, tabs, and code containing `<`, `>`, `#todo`, and backticks survive plain paste exactly apart from line-ending normalization.
- Bold text, headings, nested lists, quotes, links, code blocks, and mixed images survive save, quit/reopen, backup, and library move.
- A pre-v3 library with text and image notes upgrades with a usable backup; note dates, image IDs, bookmarks, and visible text remain intact. Literal old Markdown is not converted automatically.
- Formatted HTML paste keeps supported formatting but ignores source fonts/spacing and cannot execute scripts, load remote images, navigate the app, or forge image IDs. Plain paste into a bold selection inserts unformatted text.
- JSON formatting inside a code block preserves the block and exact numeric values; Undo restores the original content in one step. Selection-based transformations leave surrounding content intact.
- Keyword and semantic snippets, TODO counts, and hit navigation remain correct for nested blocks and Unicode. Formatting-only edits do not produce stale-index revision failures.
- Save failure or an unsupported/corrupt document preserves the last stored note and the recoverable draft; global hide/quit does not discard it.
- Check actual Cmd/Ctrl+V and plain-paste shortcuts with browser, IDE, and office-app clipboard samples on packaged macOS first. Windows and Linux native clipboard behavior remain explicitly unverified until tested there.

## Files involved

Extend `src/settings.ts` and application preferences for appearance; `src/styles.css` and panel styles for compact layout; `src/editor.ts` for schema/commands/paste; `src/document.ts` for document normalization, projection, and position mapping; `src/tools/index.ts` for structured replacements; `src/types.ts`, `src/api.ts`, and `src/main.ts` for the saved payload and lifecycle. Add a focused Rust document-validation module beside storage, and update `src-tauri/src/storage.rs`, schema migration, export, and indexing revision handling. Keep clipboard normalization in a small dedicated module if it would otherwise overload the editor class. Reuse the current smoke and UI test setup.
