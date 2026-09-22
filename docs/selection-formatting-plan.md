# Selection-based formatting under Aa

Status: implemented, 2026-09-22. This supersedes the global typography design in the original editor plan. Font selection now lives under Aa and is saved per text range. Browser checks cover partial selection, cursor typing, undo/redo, mixed values, save/reopen, safe paste, code exclusion, and symbol-font warnings; Rust checks cover storage/migration and native macOS font enumeration. Windows/Linux native validation remains pending.

## User-visible behavior

Remove **Settings → Writing → Editor appearance**, its global palette action, and application-wide typography persistence. Put font, size, paragraph spacing, and existing formatting actions together under **Aa** on the note page. Keep the global light/dark theme and unrelated Settings controls.

| Action | Scope |
| --- | --- |
| Select text, choose font or size | Only the selected text; surrounding text and other notes are unchanged |
| Place cursor, choose font or size | Subsequent typing at that cursor; do not restyle existing text |
| Select all, choose font or size | The current note's editable text, subject to code styling below |
| Change line/paragraph spacing | Paragraphs and headings touched by the selection, or the cursor's current paragraph |
| Clear formatting | Selected inline styling plus styling of affected blocks; preserve text and images |

The Aa controls show the selection's current font/size, or **Mixed** when values differ. Merely opening the controls must never apply a value. Preserve the selection while using keyboard-accessible controls; restore editor focus after applying an action. Close/invalidate the panel on date/library changes. Late font-list responses must not alter a new panel or a different note.

Offer system sans-serif, serif, monospace, and an alphabetized installed-font dropdown, with a preview. Load the list only when needed, off the UI thread. Discovery errors leave the three generic families available and explain how to retry. When a library is copied to a computer without a selected font, render that text using the app default font (system sans-serif). Retain the saved font name and show a fallback indication; do not rewrite the note. If the original font becomes available again, use it automatically. Font size and other supported formatting remain intact. Code retains its monospace default. Use existing partial discovery code after validating its dependency and macOS/Windows/Linux behavior; document any Linux build prerequisites.

Initial unstyled content uses fixed defaults: system sans-serif, 14px, line height 1.4, paragraph spacing 0px. Retain current size range 12–24px, line height 1.0–2.0, and paragraph spacing 0/4/8/12px. These are defaults, not global user settings. Custom font choices store a family name with the app default font as the rendering fallback, never font binaries or machine paths. The generic serif/monospace choices remain portable CSS families. Fonts are not downloaded.

Inline code and code blocks retain their monospace styling; mixed selections skip those runs for font/size changes and Aa explains this. Code-only selections disable unsupported typography controls. Paragraph spacing changes do not modify code indentation or literal blank lines. New paragraphs follow the editor's normal formatting inheritance; opening a different date resets pending typing styles.

## Coordinated implementation

### Symbol-font portability exception

The default-font fallback is suitable for ordinary text fonts, but it cannot preserve the meaning of font-specific encodings such as Wingdings/Webdings. The underlying character may be a normal letter or a private-use code point rather than the Unicode symbol the reader sees. Do not promise that fallback reproduces those symbols or automatically guess a Unicode replacement.

- Omit known symbol-only families (including Wingdings variants and Webdings) from the installed-font picker. Use a small, explicit case-insensitive family list; do not claim this identifies every custom symbol font.
- Recommend actual Unicode characters for symbols, or pasted images when the exact appearance matters. Images continue to be stored in the library; no font embedding or downloads are introduced.
- Imported/existing text using a known symbol font retains its original text and family metadata. If that font is unavailable, show a visible warning that symbols may display incorrectly and that the original font or an image is needed. Default-font rendering is still a best-effort display, never a claim of semantic equivalence. Do not silently replace characters or permanently remove the font information.
- Include a portability check with a known symbol-font name and private-use characters: the warning appears when appropriate, original text survives save/reopen, and the font is excluded from new selections. Unknown custom symbol fonts remain a documented limitation; detecting every encoding is outside this change.

1. **Editor and Aa:** use Tiptap's TextStyle/FontFamily/FontSize extensions for inline styles, rather than a second editor. Add restricted paragraph/heading attributes for line height and spacing. Keep the implementation in the existing editor/formatting modules. Convert `appearance.ts` into only a font-list/control helper if needed; remove its global preference behavior. Selection changes, undo/redo, heading conversions, split paragraphs, and lists must retain the intended scopes.
2. **Document persistence:** extend TypeScript canonicalization and Rust validation together. Persist only supported text-style attributes and numeric block spacing, never arbitrary CSS. Validate bounded font-family strings, the fixed default-font fallback, finite numeric ranges, mark placement, and existing size/depth/count limits. Render font names as escaped CSS values. Current canonicalization drops non-link mark attributes and Rust rejects new marks; neither can be left unchanged.
3. **Save and search:** save compressed rich content, plain projection, image references, and revision in the existing transaction. A selected font change is a real note edit and participates in autosave, close/hide flush, conflict detection, and undo. Cursor-only typing styles do not dirty a note until content changes. Text-equivalent edits retain embeddings using the existing revision update path. Projection and UTF-16 attachment/search offsets must remain identical even when text nodes split into differently styled runs.
4. **Retire global preferences:** stop reading/applying `daily-notes-editor`; clear only this retired key after the new code initializes successfully. Do not convert that machine-local preference into formatting on every stored note. Previously unstyled content therefore returns to fixed defaults; explain this visible transition in release notes. Existing bold, headings, images, and other saved formatting remain intact. Do not rewrite notes just by opening them.
5. **Documentation:** once implementation and checks pass, update README, Help, User Guide, and the implemented spec section with Aa controls, selection/cursor behavior, fallback fonts, paste behavior, and upgrade limits. Remove global-appearance instructions. Until then, keep shipped-behavior documentation distinct from this plan.

## Paste and text tools

- Same-library app copy/paste retains font/size and paragraph attributes through the existing trusted in-memory slice; retain its library isolation and image protections.
- Normal external HTML paste may preserve only validated font-family and font-size styles in addition to supported semantic formatting. Parse and allowlist individual values; do not broadly allow `style` through the sanitizer. Normalize external line heights and margins to compact destination/default spacing so the original oversized-paste problem does not return. External font names need not be installed to be retained with a fallback.
- Plain paste removes inline styles, including inherited font/size marks, and inserts literal text using default typography within the destination block. No automatic Markdown conversion. Code paste remains literal monospace text.
- Markdown has no standard font/size syntax. Markdown typing and conversion continue to support their current semantic formatting; font choices are rich-document attributes saved in SQLite. Do not add custom Markdown font syntax.
- Clear formatting must remove the new inline and block attributes. Plain-output text tools remove formatting only within their replacement range, while preserving surrounding styled text and the existing code-block behavior.

## Compatibility and recovery

Reuse the current SQLite BLOB columns; no new font tables are needed. Advance the library compatibility version to **4** after a verified pre-upgrade SQLite backup, so the previous app rejects the library before editing it. This is a compatibility gate, not a bulk content conversion. If backup fails, leave the library unchanged and report the failure.

Introduce rich-document version **2**, while retaining readers for version 1 and legacy rows without rich content. Write version 2 for newly saved documents; untouched notes retain their original representation. Versions 1 and 2 keep bounded gzip decoding and structural validation; version 1 does not silently accept version-2 attributes. Reject unknown versions or malformed styles without flattening or overwriting stored notes. Recovery export retains styled JSON plus readable text/images. The new app opens old libraries; the old app requires the pre-upgrade backup and cannot open upgraded libraries. Rolling back to that backup excludes subsequent edits.

## Required verification before shipping

| Check | Passing condition |
| --- | --- |
| Partial selection and cursor typing | Only chosen text changes; collapsed selection affects future typing; one-step undo/redo works |
| Mixed selection, keyboard controls, navigation | Mixed state is accurate; opening Aa changes nothing; menu focus retains selection; stale operations cannot touch another note/library |
| Save, restart, switch dates/libraries | Mixed fonts/sizes/spacing survive; other notes stay unchanged; unsaved close/hide flow retains existing safety |
| Projection with emoji, nested lists, TODO tags and images | Identical text and UTF-16 offsets before/after styling; search/TODO jumps and image references remain correct |
| Formatting-only indexing | Note revision advances; existing vectors remain valid; already-pending indexing is retained |
| Paste modes and clear formatting | Internal copy retains styles; external paste accepts only safe typography and compact spacing; plain paste clears inline styles; clearing formatting leaves text/images intact |
| Code and text tools | Code remains monospace; JSON formatting keeps its code block; text outside replacement ranges retains styles |
| Upgrade and validation | Legacy/v1 fixtures open unchanged; verified v4 backup exists; new styles round-trip; malformed attributes fail atomically; older app rejects v4 |
| Missing fonts and discovery failure | On another machine without the font, text uses system sans-serif while retaining the saved family, size, and formatting; code stays monospace; generic choices work; no downloads or background scanning |
| Removal and layout | No global typography Settings/palette entry; stale preferences have no effect; Aa works in light/dark themes and narrow windows |

Extend the existing shared rich-document fixture, Rust storage checks, and Playwright editor flows rather than adding a new test framework. Run TypeScript/build checks and the existing basic regression suite. Verify real installed-font discovery on macOS; record Windows/Linux native validation separately instead of claiming untested coverage.

## Assessment

This is a moderate, contained change to the existing editor and storage validator. The highest risks are silent attribute stripping, save rejection, selection loss while using Aa, and older binaries editing a new document format. The coordinated changes and checks above address those risks; the validation status above records the checks performed; Windows/Linux native behavior is still unverified.
