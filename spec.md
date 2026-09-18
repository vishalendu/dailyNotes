# Daily Notes — product and architecture specification

Status: consolidated implementation specification, 2026-09-18. No application code is included yet. Stack choices below are the proposed cross-platform implementation.

## 1. Product

A small, offline desktop scratchpad for whatever you are working on today. Launch into today's note, type or paste images, and close it without managing files. Previous days stay out of the way until you open history or search.

The interaction inspiration is [Boop](https://github.com/IvanMathy/Boop), a developer scratchpad. This app combines persistent daily pages with a curated set of Boop-style text tools, including JSON formatting.

Target desktop platforms: macOS, Windows, and Linux, with macOS as the first development platform. Use shared application code with separate platform builds and clipboard/accessibility testing. Validate minimum OS versions and supported CPU architectures in the initial dependency spike; do not claim untested platforms as supported releases.

### Defaults at a glance

| Setting | Default |
| --- | --- |
| Landing page | Today; history hidden |
| Durable autosave | After 1 second without typing; at least every 5 seconds during continuous editing |
| Semantic indexing | Batch pending saved changes every 10 minutes; no work when nothing changed |
| Model lifecycle | Download missing files on launch; load for indexing/search only; unload after indexing or 60 seconds after the last search |
| Search results | 20 unique daily notes per page, with date and snippet |
| Active search range | Last 30 days; configurable |
| Archive | Manual “Archive now,” default age older than 90 days |
| Archive search | Separate entry point; All time by default |
| Storage | One user-located SQLite library, including images and indexes |
| Commands and help | `Cmd/Ctrl+Shift+P` for navigation, text tools, settings, Help, User Guide, and Keyboard Shortcuts |

The 10-minute interval applies to expensive embedding work, not durable note saves. This preserves recent writing while limiting model activity.

### MVP requirements

- One editable page per local calendar date.
- Open today's page by default; create its database row only after the first edit.
- Plain text, multiline snippets, Unicode, links, and inline pasted images.
- Built-in developer text tools through a searchable command palette, including JSON format/minify/validate.
- Discoverable help and an offline user guide through the same command palette, with a visible Help entry point.
- Automatic saving with a visible saving/saved/error state.
- Search all saved notes by keywords and meaning through persistent local indexes.
- On-demand date navigation and history, hidden by default.
- Optional archiving of older notes, with a default age of 90 days; archived notes have a separate search entry point and never appear in normal search.
- Choose the storage folder on first launch; move the library or open another library later.
- Store notes, images, and the index in a database, with no Markdown files or external image folder.
- Writing and keyword search work offline immediately. Semantic search works offline after a one-time model download; no account or inference server is required.

## 2. Recommended stack

| Concern | Choice | Reason |
| --- | --- | --- |
| GUI/build | TypeScript, HTML/CSS, Vite | Small shared frontend; no additional UI framework required initially |
| Desktop shell | Tauri 2 with Rust application logic | System webview, window, tray, filesystem access, and platform packaging |
| Editor | Tiptap open-source core with a minimal schema and inline image node | Reuse editing, composition, selection, and undo behavior |
| Persistence | Bundled SQLite through `rusqlite`, with FTS5 enabled | Consistent embedded database capabilities across platforms |
| Search | SQLite FTS5 + statically linked `sqlite-vec` | Keyword and vector retrieval inside the same library |
| Embeddings | ONNX Runtime via Rust `ort`, with a matching tokenizer | Local cross-platform inference; model weights downloaded separately |
| Images | Clipboard/drop handling; Rust image decoding and SHA-256 | Validate, thumbnail, encode, and deduplicate before storage |
| Concurrency | Async command boundary, serial database worker, one inference worker | Keep disk and model operations off the editor thread |
| Preferences | Small settings file in the OS app-data directory | Remember library location, search settings, and window preferences |
| Verification | Rust storage integration tests and editor/browser checks | Exercise persistence and platform-specific interactions |

Pin dependency/model revisions and bundle license notices. Use no ORM, local HTTP server, Python runtime, or cloud service. Tauri uses each platform's system webview; memory and rendering still need measurement on each target OS. See [Tauri's architecture overview](https://v2.tauri.app/start/), [Tiptap inline images](https://tiptap.dev/docs/editor/extensions/nodes/image), and [ONNX Runtime](https://onnxruntime.ai/docs/get-started/with-c.html). The editor image extension handles presentation; our paste/drop integration handles local bytes and persistence. Verify the Rust bindings, bundled runtime, static `sqlite-vec` registration, FTS5, and image clipboard flow before building the full UI.

### Why SQLite instead of DuckDB or Parquet?

| Option | Fit for this application |
| --- | --- |
| SQLite | Recommended: small transactional edits, image BLOBs, indexed lookups, and full-text search in one local library. SQLite explicitly supports desktop application file formats. |
| DuckDB | An analytical database; useful for bulk analysis, but its strengths do not justify choosing it for autosaving individual notes. |
| Parquet | A compressed columnar file format, not a transactional application database. Frequent edits and a live search index would require additional machinery. |

These choices follow the documented roles of [SQLite](https://www.sqlite.org/whentouse.html), [DuckDB](https://duckdb.org/why_duckdb), and [Parquet](https://parquet.apache.org/docs/overview/).

A database is not automatically smaller than Markdown. Text files are already compact; database pages and search indexes add overhead. The practical benefits are organization, transactional saves, indexing, and portable image storage. Images will usually dominate size. Store their encoded bytes once, never Base64, and avoid duplicating the note body in a second document format. Do not add text compression until real measurements justify it.

## 3. User experience

### First launch and normal use

1. Show “Create library” with a suggested OS application-data location, “Choose folder,” and “Open existing library.”
2. Create `DailyNotes.sqlite` in the chosen folder after validating write access. Never overwrite an existing database.
3. Show today's date and an empty editor, with keyboard focus ready for typing.
4. Subsequent launches open today's page directly. The selected location persists across launches.

The main window contains a date heading, Today, Search, History, and the editor. A quiet status label indicates save state. History appears as a dismissible panel listing active dates and short previews, with a separate “Archive” entry offering “Search archive.” Opening the app never displays the full history by default.

- `Cmd/Ctrl+F`: find within the current page.
- `Cmd/Ctrl+Shift+F`: search the library.
- `Cmd/Ctrl+T`: return to today.
- `Cmd/Ctrl+V`: paste text or an image at the caret.
- Platform-standard undo/redo shortcuts, including image insertion and removal.
- `Cmd/Ctrl+S`: immediately flush pending edits; automatic saving remains the default.
- `Cmd/Ctrl+Shift+P`: open the app command palette, including text tools and help.
- Escape dismisses search/history and returns focus to the editor.

Use a readable monospaced default, preserve indentation and line breaks, and disable automatic smart quotes/dashes for technical notes. Support light/dark appearance, keyboard navigation, text zoom, and screen-reader labels. Rich formatting, rendered Markdown, and syntax highlighting are outside the MVP.

Provide “Keep running in background,” enabled when a functional tray/menu-bar entry is available. Closing the window flushes edits and hides it; the tray provides Open and Quit. Explicit Quit always flushes and terminates. If the desktop has no usable tray, fall back to normal window-close behavior rather than leaving an inaccessible background app. Starting at OS login is opt-in.

### Command palette, help, and user documentation

Make the command palette the central entry point for secondary actions. Keep Today, Search, and a compact command button in the main UI; preserve the on-demand History entry. Avoid a large Tools menu or nested feature menus. Retain normal platform application/edit menus for expected OS behavior and accessibility.

- The command button has a descriptive accessible label and shows the palette shortcut in its tooltip. A small visible “?” Help button opens Help directly, so help is discoverable without knowing a shortcut.
- Palette entries include Today, History, Search notes, Search archive, Settings, Storage, Archive older notes, Back up now, text utilities, Help, User Guide, and Keyboard Shortcuts. Group results under Navigate, Tools, Settings, and Help in one flat list; do not require navigating submenus.
- Search command names, concise descriptions, and aliases: “docs,” “manual,” and “readme” find User Guide; “pretty print” finds Format JSON. Show the matching action, its description, shortcut if any, and whether it acts on the selection or page.
- Keyboard navigation uses Up/Down and Enter; Escape closes the palette and restores editor focus/selection. Disabled actions explain why. Opening help or settings must preserve the unsaved draft and editor selection.
- Help opens a lightweight dismissible panel with a short orientation, links to guide topics, and explanations of visible states such as Saving, Meaning search pending, and Model downloading. No mandatory onboarding tour.
- User Guide opens the full bundled guide in the same panel, with a small contents list and in-guide text find. It documents daily pages, images, saving, keyword/meaning search, filters, archive/restore, text tools, model downloads, storage/backup, and background behavior. Help search searches documentation only and never queries private notes.
- Keyboard Shortcuts displays shortcuts for the current OS using the same command definitions as the palette. Keep command labels, descriptions, aliases, shortcuts, and enabled states in one small registry; do not build a generic plugin system.
- Contextual “Learn more” links open the appropriate guide section from storage, archive, and search settings. Use an accessible dialog/panel with managed focus, selectable text, and keyboard dismissal.

Documentation sources: [README.md](README.md) is the repository overview and feature summary; [docs/user-guide.md](docs/user-guide.md) is the user-facing source of truth. Bundle the guide as a read-only app resource so it works without internet. Render a sanitized, restricted Markdown subset using an existing parser if available, with raw HTML disabled; do not build a custom parser or load GitHub at runtime. Markdown documentation is permitted: the prohibition on `.md` storage applies to user notes. Update the guide alongside user-visible behavior changes, and remove planning labels only when those behaviors ship.

### Boop-style developer tools

Include a curated set based on [Boop's built-in scripts](https://github.com/IvanMathy/Boop/tree/main/Boop/Boop/scripts), not just its scratchpad appearance. The top-level `Scripts/` directory contains additional community scripts; it is not the built-in collection.

| Category | Initial commands |
| --- | --- |
| JSON | Format with two-space indentation; minify; validate; sort object keys recursively while preserving array order |
| Encoding | Base64 encode/decode UTF-8 text; URL-component encode/decode; HTML entity encode/decode |
| Text case | Uppercase, lowercase, camelCase, snake_case, kebab-case |
| Lines | Sort ascending/descending, natural sort, remove duplicate lines, trim trailing whitespace, remove empty lines, join lines |
| Inspection | Character/word/line counts; JWT header/payload decode with an explicit “signature not verified” label |
| Dates | Unix timestamp to UTC date and reverse, with explicit seconds/milliseconds choice and ISO 8601 input |
| Utilities | SHA-256 digest of selected UTF-8 text; UUID v4 generation |

**Interaction:** opening the palette preserves the editor selection and identifies the target as “Selection.” With no selection, read-only tools may inspect the page; transforming tools offer an explicit “Use entire note” action. If the target includes an image, require a text-only selection rather than stripping images. Generated values insert at the caret or replace selected text. Inspection results appear in a small result panel with Copy; they do not overwrite the note.

Each successful transformation is one undoable editor transaction, leaves surrounding text/images untouched, and follows normal autosave and delayed indexing. Invalid input displays an error without changing the draft. Async tools capture the library, note revision, and selection; discard the result if those change rather than overwriting newer writing. Escape cancels without altering the note. Archived notes retain their archived state after a transformation.

**Implementation:** keep a small static command list and pure text functions in the frontend, using standard APIs where correct. Use a worker for potentially expensive parsing; create it on demand and terminate it after the operation. Reject inputs above an initial 1 MiB UTF-8 limit with a clear message and allow cancelling work exceeding a short execution budget. No model loading, network calls, shell execution, `eval`, or user-installed scripts are needed for these tools.

JSON operations must preserve numeric literals, including integers beyond JavaScript's safe range, rather than silently rounding through `JSON.parse`/`JSON.stringify`. Use a tested token-preserving formatter/parser for transformations; report duplicate keys and reject key sorting when duplicates would make it ambiguous. Keep JSON validation strict: do not evaluate JavaScript object literals. Base64/URL decoding must report malformed input; non-UTF-8 binary output cannot replace note text. Define UTF-8 encoding for hashes, grapheme-based character counts, and consistent line-ending behavior. HTML entity decoding produces text, never rendered HTML.

Review and adapt useful upstream implementations when they fit the app; prefer platform APIs over carrying redundant Boop dependencies. Record the upstream commit/path for copied code and retain copyright/license notices under `third-party/Boop/` and in app acknowledgments. Boop's [MIT license](https://github.com/IvanMathy/Boop/blob/main/LICENSE) is the starting provenance reference; review any separately licensed bundled libraries before reuse. No Boop source has been imported at the specification stage.

SQL/XML/CSS formatting, CSV/YAML conversion, and importing arbitrary Boop scripts remain extensions to this initial set. They are not required to ship JSON formatting and the common text utilities above.

### Day boundaries

Use a Gregorian `YYYY-MM-DD` key calculated in the system's current time zone. Store creation/update timestamps in UTC. Existing date keys never change after travel or a time-zone change.

At midnight, wake, or activation, recalculate today. If the editor is idle on the previous day's page, flush it and switch to today. If typing, composing text, or viewing history, preserve the current page and show “New day — open today.” Opening a past date always edits that date. Never create pages for skipped days or redirect keystrokes during an active edit.

## 4. Architecture

```text
Tauri webview: editor, search/history, settings
                  |
       TypeScript state + Tiptap editor
                  |
       validated Rust commands / snapshots
                  |
       serial SQLite store queue
                  |
          DailyNotes.sqlite
    notes + images + FTS + vectors
                  ^
       background local embedding worker
```

Keep one application instance and one active library/editor. Tauri's webview may use additional OS processes; this is not a single-process memory promise. UI state owns the selected date, draft, and monotonically increasing edit revision. The Rust store owns schema migration, transactions, search, and backup. A small library-location component owns folder access and relocation. These are concrete responsibilities, not a plugin architecture or generic repository framework.

Expose narrow commands for saving, searching, images, and library operations, not arbitrary SQL or filesystem access. Validate command payloads and size limits in Rust. Render only packaged application assets; use a restrictive content security policy and prohibit pasted scripts, remote images, and remote page navigation. Open user-clicked external links through the OS only after validating their scheme.

Search requests carry a generation number so stale results cannot replace newer ones. Saves carry a library identity, note identity, and revision; queued callbacks must never update the wrong page or mark newer edits as saved.

## 5. Data model

Use `PRAGMA user_version` for schema migrations and an application identifier to distinguish this database from arbitrary SQLite files.

| Table | Essential columns and constraints |
| --- | --- |
| `notes` | `id INTEGER PRIMARY KEY`, `day TEXT NOT NULL UNIQUE`, `body TEXT NOT NULL`, `revision INTEGER NOT NULL`, `is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0,1))`, `created_at`, `updated_at` |
| `images` | `id INTEGER PRIMARY KEY`, `sha256 TEXT NOT NULL UNIQUE`, `mime_type`, `width`, `height`, `bytes BLOB NOT NULL` |
| `note_images` | `note_id` foreign key, `utf16_offset INTEGER`, `image_id` foreign key; primary key `(note_id, utf16_offset)` |
| `notes_fts` | FTS5 external-content index of `notes.body`, keyed by `notes.id` |
| `note_chunks` | `id INTEGER PRIMARY KEY`, `note_id` foreign key, `note_revision`, `ordinal`, UTF-16 start/length, `text_hash`; chunk text is recoverable from the note |
| `chunk_vectors` | `vec0` virtual table keyed by chunk ID, with one fixed-dimension float32 vector per chunk |
| `semantic_state` | One row per note: desired revision, indexed revision, pending-since timestamp, and model/chunker version; durable indexing work state |
| `library_settings` | Key/value settings for this library, including the archive age and stable library identity |

Add a composite index on `notes(is_archived, day)` for active/archive date queries. Archive state is metadata, independent of the text revision used by the embedding worker.

### Text and attachment representation

Persist the editor's text with one U+FFFC object-replacement character for each inline image. Store each image occurrence's UTF-16 offset in `note_images`, matching JavaScript string offsets. Use a restricted editor schema of paragraphs, text, hard breaks, and inline images. Define a deterministic serializer: paragraph boundaries and hard breaks become newlines, and each image becomes one placeholder. Rebuild offsets by traversing the document on save rather than manually shifting positions after every edit. Rust must convert UTF-16 offsets safely rather than treating them as byte positions.

On load, reconstruct editor image nodes at those positions using the referenced images. Validate that offsets are ordered, in range, and point to attachment characters. Treat incoming literal U+FFFC text as ordinary sanitized text rather than inventing a missing image. This format stores the text once and image bytes once, including when an image is reused in several notes. Maintain an offset-to-editor-position mapping for search navigation; editor node positions are not interchangeable with serialized text offsets.

No raw HTML, archived editor object graph, or embedded Base64 is part of the durable format. Formatting pasted from other apps becomes plain text; image paste remains an attachment. Text adjacent to images must still tokenize as separate words. Serve images through scoped app-local binary responses or temporary object URLs, and release those URLs when views are disposed.

## 6. Saving and durability

- Debounce saves by approximately 1 second; during continuous typing, take a snapshot at least every 5 seconds. Never invoke the embedding model from the save path.
- Flush on navigation, library search, deactivation, library switching, and normal quit. Defer termination until the save succeeds or the user explicitly chooses how to handle failure.
- One transaction writes new image bytes, the note body, attachment references, and the associated search-index changes.
- Enable foreign keys, WAL journaling, `synchronous=FULL`, and a bounded busy timeout. Use parameterized SQL everywhere.
- Show “Saved” only when the latest snapshot commits. Failures keep the draft available, show an actionable error, and permit retry or emergency export.
- An abrupt crash can lose edits newer than the last committed snapshot; do not promise zero loss of unsaved keystrokes.
- Run versioned migrations transactionally after making a backup. Reject newer unsupported schemas without changing them.

WAL may produce `DailyNotes.sqlite-wal` and `DailyNotes.sqlite-shm` beside the database while it is open. Those are database machinery, not separate note files. A live `.sqlite` file alone must not be copied as a backup. See [SQLite WAL documentation](https://www.sqlite.org/wal.html).

## 7. Indexed search

Use FTS5 with the `unicode61` tokenizer and an external-content index to avoid a second stored copy of the note body. Database triggers maintain the index on insert, update, and delete in the same transaction. Provide a rebuild operation for index recovery. FTS5 supports indexed terms, prefixes, ranking, and result snippets; see [the FTS5 documentation](https://www.sqlite.org/fts5.html).

Search UI contract:

- Normal Search always searches active notes only. “Search archive” opens the same search panel with a clearly labeled Archive scope and searches archived notes only. The regular search shortcut always opens active search; do not silently remember archive scope as the default.
- Case-insensitive word matching; multiple words require all words to occur.
- An explicit trailing `*` means a word-prefix query. Arbitrary middle-of-word substring matching is not included initially.
- Quote and escape user terms before constructing a bound FTS query; punctuation or unmatched quotes must never cause an SQL/FTS error.
- An empty query shows recent dates. An exact valid `YYYY-MM-DD` query also offers direct date navigation.
- Show 20 unique daily notes initially, each with its date and a two-to-three-line relevant snippet. “Load more” adds up to 20 further notes without duplicates; hide it when results are exhausted. Do not report an exact match count unless it has been computed.
- Provide a date filter: Last 7 days, Last 30 days, Last 90 days, Custom last X days, and All time. Default to Last 30 days for active search and All time for archive search; remember date selections separately for each scope. Keep the active filter visible; offer “Search all time” when no results are found. All time expands dates only, never the active/archive scope. In active search, also offer a separate “Search archive” action that carries over the query.
- Custom X must be a positive whole number within the platform's supported calendar range. “Last X days” includes today and the preceding X−1 local calendar dates, using the note's date rather than its last-edit timestamp. X=1 means today. Exclude future dates in relative ranges; use calendar arithmetic rather than subtracting 24-hour durations.
- Rank by Best match by default, breaking ties by newest note date. Offer Newest first to sort matching candidates by note date descending. For semantic/hybrid search this reorders the retrieved candidate set, not every note in the library; expand retrieval when loading more.
- Debounce requests by roughly 150 ms and cancel or ignore obsolete requests. Changing the query, scope, range, or sort resets pagination. Freeze the date bounds for a search session so midnight cannot shift later pages unexpectedly.
- Highlight literal keyword matches; for meaning-based matches, show the relevant passage without inventing a literal word match. Selecting a result opens the original editable page and scrolls to the passage. Search covers committed text, including the current draft after a successful flush.

The matching rules above describe keyword mode. Default library search combines keyword and semantic results; a simple mode selector also offers Keywords and Meaning. Image pixels are not searchable in the MVP. OCR, explicit typo correction, CJK-specific segmentation, and arbitrary substring indexing are later capabilities if actual usage requires them.

### Semantic search: keep SQLite, add embeddings

SQLite does not generate semantic embeddings by itself. A local model maps text to a numeric vector, and the [sqlite-vec extension](https://alexgarcia.xyz/sqlite-vec/) stores and searches those vectors in SQLite. No separate vector database or server is needed.

Example: a query such as “problems deploying the app” should retrieve a note about “release failed because the container could not start,” even without shared keywords. Exact identifiers, error codes, and filenames still benefit from keyword search.

**Initial model candidate:** `sentence-transformers/all-MiniLM-L6-v2`, an English-oriented model producing 384-dimensional embeddings. Its documented input limit is 256 word pieces, so never embed a whole long daily page with silent truncation. See the [model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2). Start by evaluating the published INT8 ONNX model appropriate to each target architecture with the matching tokenizer. Validate attention-mask-aware mean pooling, normalization, and retrieval quality against the original model. Quantized CPU-specific variants are not assumed interchangeable or available on every machine; provide a validated compatible variant per target and include its identity in the index version. Use the standard ONNX artifact if quantization fails compatibility or quality checks. No model training, Ollama, Python runtime, or inference server is required.

**Model download and startup lifecycle:**

- Keep weights, downloaded tokenizers, and conversion output out of Git. `.gitignore` excludes the repository's `/models/` staging folder and common model formats. Commit only conversion/download code, license notices, and a small manifest containing the model revision, tokenizer/chunker version, HTTPS artifact URLs, byte sizes, and SHA-256 checksums.
- At each app launch, check for the pinned model under the OS app-data directory: `Models/<model-id>/<revision>/<variant>/`. Resolve this through Tauri's platform path APIs. This shared model directory is separate from the user-selected notes database and does not move with it.
- Open today's editor immediately. If the required assets are missing, automatically start one background HTTPS download from Rust; show progress and offer cancel/retry. Existing verified assets are reused without a network request. Checking/downloading the files does not create an inference session; load the model only when indexing or semantic search needs it.
- Download to temporary files, validate expected sizes and checksums, and atomically promote the complete asset set. Validate extracted archive paths and size limits if packaging requires an archive. Incomplete, corrupted, or incompatible assets must never be treated as a ready model.
- Download a tested ONNX artifact plus its matching tokenizer from an immutable upstream revision or a versioned release outside Git. Do not convert or train models on the user's machine. Populate exact URLs and checksums from tested artifacts before shipping. Package the platform-specific ONNX Runtime library with the application so users need no separate installation.
- When offline or a download fails, keep writing and keyword search fully usable; mark meaning search unavailable until download succeeds. Retry on user request or a later launch, without a tight retry loop. Once ready, allow on-demand semantic queries and process pending embeddings at the next scheduled batch.
- App updates select an explicit model revision rather than downloading an unpinned latest version. A changed embedding pipeline triggers the semantic rebuild described below. Never upload notes or search queries to obtain embeddings.

**Size budget:** published standard ONNX weights are about 90.4 MB; the INT8 ONNX variants are about 23 MB. Tokenizer/configuration assets add less than 1 MB. Download only the selected compatible variant, not the whole repository. These sizes exclude the packaged inference runtime, runtime RAM, notes, and vector index. See the [original model files](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/tree/main) and [ONNX variants](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/tree/main/onnx).

**Indexing pipeline:**

1. Split saved text at paragraph boundaries, breaking oversized paragraphs into approximately 200-word-piece windows with 32-token overlap, including space for special tokens. Store source ranges so results open the matching passage.
2. In the note-save transaction, mark its latest revision as requiring embedding and invalidate older chunk/vector rows. FTS becomes current immediately; embedding never delays saving.
3. On the first pending saved change, schedule a batch for 10 minutes later; subsequent saves update pending work without resetting that deadline. Persist pending work across launches. At the deadline, load the model once and process the latest saved revisions in small batches, then release its session and buffers. If no notes changed, no indexing timer or inference work is needed. If asleep, handle one overdue batch on wake, without replaying missed intervals. Empty or image-only notes need no text vectors. Work remaining after a batch schedules the next batch; prevent overlapping inference jobs.
4. Commit chunks/vectors and the indexed revision together only if the library identity, note revision, and model version still match. Discard obsolete results. Delete vectors explicitly with their chunks; virtual tables do not provide ordinary foreign-key cascades.
5. On model, tokenizer, or chunker changes, invalidate and rebuild the semantic index. Never compare vectors produced by different model versions, even if dimensions match. The original notes remain authoritative and keyword search stays available.

**Query pipeline:** embed the query with the same model, retrieve nearest chunks by cosine distance, and collapse to one result per note using its best chunk. Separately retrieve keyword results. Combine the two note rankings using reciprocal rank fusion, initially `sum(1 / (60 + rank))`, rather than adding incompatible cosine and FTS scores. Fetch enough chunk candidates to populate the requested number of unique notes; expand the candidate count if one long note dominates. Show the relevant passage and date. Do not label distances or fused rankings as confidence percentages.

Apply the selected date range to both keyword and vector retrieval before selecting their top candidates. For vectors, use date metadata supported by the pinned extension or exact distance scoring over eligible chunks joined to `notes`; never take the global nearest candidates and only then discard dates outside the range. Keep passage offsets available for opening results. Cache the displayed result IDs for the current query/range/sort, append unseen results when retrieval expands, and preserve displayed ordering until the user refreshes; background saves must not cause duplicate or jumping pages.

Apply active/archive scope before candidate selection in both retrieval paths as well. Join against the current `notes.is_archived` value, or maintain equivalent vector metadata transactionally; do not rely on stale embedding-job metadata. Archive/restore invalidates cached results and pending search callbacks so a note cannot remain visible in the wrong scope. Include scope in every search cache key.

The semantic index is eventually consistent. While work is pending, show “Meaning search has pending updates,” and show an updating indicator while the worker is active. Fresh saved notes remain discoverable by keywords. Under normal awake operation, semantic indexing starts within approximately 10 minutes; sleep, a missing model, and large backlogs can extend the delay. Missing model assets or inference failure must preserve note editing and keyword search and offer an index retry/rebuild.

### Background resource policy

- Saves update SQLite/FTS and pending indexing state only. Never reload the model for each autosave.
- Semantic search needs a query embedding even when all notes are already indexed. Load the model on demand; show keyword results immediately while meaning results are prepared. Retain the session for 60 seconds after the last semantic query to avoid reloads between keystrokes, then release it. Keyword-only, empty, and direct-date searches do not load the model.
- Share one inference worker between queries and indexing. Serve interactive queries between small indexing batches, cancel stale queued queries, and release the session after a batch unless a recent search still needs the 60-second grace period.
- Use events and one-shot deadlines rather than frequent polling. No periodic database scans or background inference when the queue is empty. Load only the visible note's images and bounded search results.
- Pause new indexing when shutting down; retain pending jobs for next launch. Normal quit flushes notes without waiting for embeddings.
- Releasing a model session does not guarantee all process memory returns to the OS immediately. Measure the app plus webview processes before deciding whether an isolated inference process is necessary; do not add one preemptively.

**Scale and storage:** a 384-dimensional float32 vector uses 1,536 bytes, so 50,000 chunks require about 73 MiB of raw vectors, plus metadata and database overhead. Model weights add app size separately. Start with `sqlite-vec` exact nearest-neighbor retrieval; do not describe it as an approximate HNSW index or promise sublinear search. Benchmark actual library sizes before adding an ANN engine. The extension documents [nearest-neighbor queries](https://alexgarcia.xyz/sqlite-vec/features/knn.html); pin and verify the chosen version's behavior.

Semantic search ranks similarity, not truth, and may return weak matches. Validate using representative paraphrases and unrelated queries before deciding a model-specific cutoff. English is the first target; multilingual support requires a separately evaluated model. Searching image content still requires OCR or a multimodal model and is outside this implementation.

## 8. Images and space management

Accept image clipboard content and local PNG/JPEG image drops. Prefer existing PNG/JPEG bytes; convert TIFF or other supported clipboard bitmap representations to PNG. Decode and validate before insertion. Preserve screenshot clarity and do not silently downscale the stored original.

Initial guardrails: reject an encoded image over 25 MiB or an image over 40 megapixels with a clear message. Inspect metadata before full decoding. Generate display thumbnails off the main thread and load full image bytes only when needed. Opening history or searching must not load image BLOBs.

Deduplicate identical encoded bytes with SHA-256; visually identical images with different encodings may still occupy separate rows. Pasting an image and its note references must commit atomically.

Retain removed images while the active editor's undo stack can restore them. After a successful save and clearing that undo session, remove unreferenced image rows. Provide explicit “Compact library” maintenance to reclaim free pages; do not vacuum on every save. No automatic deletion of old notes.

## 9. Choosing and changing storage

Settings → Storage displays the current folder and offers “Move library,” “Open existing library,” “Create library,” and “Back up now.” Store the selected path and platform access grants in preferences; use security-scoped bookmarks only for macOS distribution modes that require them. Notes remain solely in the selected database. If access is lost, ask the user to reselect the folder.

### Move library safely

1. Finish pending edits, pause editing/indexing, and drain all queued store operations. Cancel or invalidate in-flight embedding results for the old library generation.
2. Validate destination permissions, available capacity, and that the source/destination are distinct. Refuse to overwrite an existing library.
3. Use SQLite's backup API to create a temporary destination database. Do not copy the live main file with filesystem operations.
4. Close the destination backup connection, run integrity/foreign-key checks, and verify note/image counts and schema version against the paused source.
5. Rename the verified temporary database to its final name within the destination folder, open it successfully, then atomically persist its path/access grant as the active location.
6. Close the old library and resume editing. Keep the original as a recovery copy and clearly report its location; deletion is an explicit later user action.

Any failure before the switch keeps the old library active. A crash before preferences change leaves the source authoritative; a crash afterward leaves the verified destination authoritative. A failed preferences update must not silently discard access to the original.

Opening another library follows the same flush-before-switch rule but does not merge databases. If the saved folder is unavailable, show reconnect/choose-location options; never silently create an empty replacement library.

Support local writable folders and locally attached drives. A live library on a network share or concurrently synchronized cloud folder is unsupported; copying completed backups there is separate from live database access. Enforce one writable app instance per library with an OS-held lock, released automatically on process exit.

SQLite's [backup API](https://www.sqlite.org/backup.html) provides the consistent database-copy mechanism used by both backup and relocation.

### Archiving older notes

Settings → Storage → “Archive older notes” provides an age field defaulting to **90 days**, an eligible-note count, and an “Archive now” action. Remember the chosen age per library. Archiving is user-initiated; age alone does not silently move notes into the archive. A background archival schedule is outside this initial option.

- Validate the age as a positive whole number within the supported calendar range. Archive active notes whose calendar-date age is strictly greater than X days: `day < today − X calendar days`. A note exactly 90 days old remains active with the default setting; a note 91 days old is eligible. Use local calendar arithmetic, not elapsed hours or last-edit timestamps, and show the actual cutoff date beside the count.
- Flush pending edits before archiving; abort on save failure. Update all eligible notes in one transaction. If a preview is displayed, compute it and execute against the same frozen cutoff; report the actual number archived.
- Keep archived notes, images, and both search representations in the same SQLite library. Archiving hides notes from active history/search and narrows the eligible search corpus; it does **not** shrink the database file or move data into monthly files. It is not a backup or deletion.
- Archive search supports keyword and semantic matching, the same snippets, batches of 20, and date/sort controls. It starts with All time so notes older than 90 days are visible immediately.
- Opening an archived note displays an Archive badge and a “Restore to notes” action. It remains editable; editing or navigating to its date does not silently restore it or create a duplicate daily note. Changed text follows the normal save/index pipeline in archive scope.
- Restore clears `is_archived` transactionally without changing the note date or duplicating images. Archiving/restoring alone does not regenerate embeddings. A restored old note can still be outside active search's Last 30 days filter; communicate this and offer All time.
- A later explicit “Archive now” can rearchive restored notes if their dates still qualify. Backups and relocation include both active and archived notes automatically.

## 10. Privacy and recovery

Network access is used only to download missing pinned model assets. No analytics, remote images, note uploads, or remote inference. Writing and keyword search never require connectivity; semantic search runs offline once its model is installed. The MVP database is unencrypted; use normal filesystem permissions and the user's disk encryption. App-level password protection would need a separate encryption design.

“Back up now” creates a timestamped SQLite snapshot in a user-selected folder. Backups contain both text and images and can be opened as libraries. A copy on the same disk protects against some editing mistakes, but not disk failure. Automatic backup scheduling and note revision history are deferred.

If integrity checks fail, preserve the database, offer opening a backup, and avoid automatic destructive repair. Provide emergency export of an unsaved page as text plus image files when saving is impossible; this is recovery output, not the normal storage format.

## 11. Implementation plan

1. **Prove the core:** create the Tauri editor and SQLite store; verify FTS5, `sqlite-vec`, and local ONNX inference on each intended release platform; round-trip Unicode text and multiple inline images through close/reopen. Check semantic retrieval on a small set of paraphrase queries before committing to a model variant.
2. **Daily writing and tools:** add date selection, first-run folder selection, autosave state, undo, day rollover, persistence across launches, and the command palette with JSON and other scoped text transformations. Include Help, the bundled User Guide, and shortcuts generated from command definitions.
3. **Retrieval:** add transactionally maintained FTS, safe query construction, snippets, hidden-by-default history, startup model download/reuse with integrity verification, durable background embedding, and hybrid ranking.
4. **Library operations:** add platform folder access, switching, backup, relocation, optional 90-day archiving, separate archive search, restore, migration backup, and failure recovery.
5. **Release checks:** exercise clipboard/accessibility and background/tray flows on each target OS, measure a realistic large library and idle resource usage, generate platform icons from the master artwork, then package installers. Sign Windows/macOS builds and notarize macOS distribution when signing credentials are available.

## 12. Acceptance and validation

Use a small Rust storage integration suite plus manual editor checks on each supported webview; avoid a large mock-based test architecture.

| Check | Expected outcome |
| --- | --- |
| First launch and restart | Chosen folder persists; today opens; older pages are hidden |
| Midnight, sleep/wake, and time-zone change | Correct date offered without stealing active input or reassigning old notes |
| Edit, close, reopen | Last acknowledged save is intact |
| Unicode and images | Emoji, combining characters, image order, and surrounding text round-trip correctly |
| Paste/remove/undo/redo | Images survive save/reload and editor undo; no dangling references |
| Text tool scope and undo | Only the selected text changes; whole-page transformation is explicit; images are preserved; one undo restores the input |
| Tool invalid/stale input | Malformed JSON/Base64/URLs, oversized input, and outdated async results never modify the note |
| JSON and Unicode fidelity | Formatting preserves large numeric literals, array order, and Unicode; decoded HTML stays inert text |
| Help and documentation | Help button and palette reach the offline guide; docs/readme aliases work; opening/dismissing help preserves draft and selection |
| Palette accessibility | All actions are keyboard-reachable, shortcut labels match the OS, disabled actions explain why, and focus returns to the editor |
| Search after insert/edit/delete | Committed results reflect the transaction; punctuation cannot break the query |
| Search date filter | Last 1/7/30/custom days includes the correct local dates across daylight-saving boundaries; older notes edited today remain outside the range |
| Filtered hybrid retrieval and pagination | Relevant notes inside the range are not crowded out by older global matches; results appear in batches of 20 unique dates, with correct snippets and no duplicate pages |
| Archive cutoff and transaction | Default is 90 days; exactly 90-day-old notes remain active, older eligible notes archive atomically; failed draft saving prevents archiving |
| Active/archive isolation | Keyword and semantic results obey scope before candidate limits; All time does not include the other scope; archive search initially uses All time |
| Restore and archived editing | Date, text, images, and embeddings are preserved; editing does not silently restore; cached results cannot leak across scopes |
| Semantic paraphrase queries | Relevant notes appear in the top five for at least 80% of a hand-labeled set of 30 representative queries; treat this as a release target to measure |
| Edit/delete during embedding | Old vectors never reappear; pending indexing resumes after restart |
| Model change or inference failure | Rebuild is resumable; editing and keyword search continue without mixing embedding versions |
| Model absent, cached, or partially downloaded | Missing assets download in the background; verified cached assets work offline with no request; interrupted/corrupt downloads cannot activate |
| First launch offline | Today's page, saving, and keyword search work; meaning search reports that its model still needs downloading |
| Autosave versus indexing | Saves never load the model; changed notes are batched at the 10-minute deadline without resetting it on every edit |
| Model release and search | Indexing releases its session; semantic queries share a session until 60 seconds idle; stale queries cannot overwrite current results |
| Idle and window close | No polling/inference with no pending work; tray reopen works; explicit Quit flushes and exits; no tray means no inaccessible background instance |
| Transaction interruption | Previous committed note remains readable; no partial image/index update |
| Disk full or access loss | Visible save error, draft retained, retry/export available |
| Relocation success/failure | Verified destination activates only on success; original remains recoverable |
| Unsupported or damaged library | Clear error without silently replacing or modifying it |
| Migration and backup restore | Text, dates, attachments, and search survive reopening |

Performance targets, to measure rather than assume: on an Apple Silicon Mac with local SSD, open today's text within 500 ms after app initialization; return the first search page within 100 ms at p95 excluding UI debounce. Benchmark 10,000 notes averaging 5 KiB of text and a separate image-heavy library. Record hardware, cold/warm timings, index size, and total disk use. Keep full-library reads and image decoding off the typing path.

The 100 ms target applies to keyword results. Target warm semantic/hybrid results within 500 ms at p95 for 50,000 chunks, including query embedding; measure cold model startup separately. Report indexing throughput and results on representative Windows/Linux hardware as well. These are benchmark goals, not guarantees from the database choice.

Measure total resident memory across the app and webview processes in four states: visible idle, hidden idle after model release, batch indexing, and semantic search. Record CPU and wakeups over at least five idle minutes, with a target below 1% average CPU when no work is pending. Report actual download/install size, peak inference memory, and whether memory drops after session release; do not infer RAM usage from model file size.

### App icon

Master artwork: [assets/daily-notes-icon.png](assets/daily-notes-icon.png), a 1254 × 1254 PNG with transparency. The design is a playful yellow notepad with blue binding rings, bold note lines, a folded page, and a coral tab. Generation provenance and the exact prompt are in [assets/icon-prompt.md](assets/icon-prompt.md); the built-in Imagegen tool was used.

During application packaging, export platform-required PNG, ICO, and ICNS sizes using the standard icon tooling, and inspect small-size legibility on light/dark backgrounds. Keep the master in Git; it is an application asset, unlike the downloaded embedding weights. Platform exports are an implementation step, not generated deliverables in this specification-only phase.

## 13. Explicitly deferred

Cloud sync, mobile/web clients, collaboration, generative AI assistants, tags/folders, multiple pages per day, rich formatting, arbitrary Boop script execution/import, OCR, and full revision history. Local embeddings and the curated developer text tools above are in scope. Add other capabilities only when the daily writing/search workflow demonstrates a concrete need.

## Implemented enhancement: TODOs and named bookmarks

- Match standalone `#todo` tags case-insensitively in saved note lines. The TODO view shows dated line snippets, newest first, with a default last-7-days range including today, a custom day count, all time, text filtering, and a separate archive-only scope. Selecting a hit opens its page at the line's UTF-16 offset. Removing the tag removes the line from this view after saving. No separate completion state is introduced.
- Use SQLite FTS5 to find candidate TODO pages, then validate tag boundaries and extract matching lines. Return up to 100 visible results per batch with Load more. No embeddings or background task index is required.
- Named bookmarks are reusable page labels. A page may have several; the picker can create names, select assignments, or remove assignments. Bookmarks may reference an empty date page. Browse bookmarked pages by name, text, age, and active/archive scope; deduplicate pages assigned to several bookmarks.
- Schema version 2 adds `bookmarks(id, name COLLATE NOCASE UNIQUE)` and `page_bookmarks(day, bookmark_id)` with a composite primary key and reverse lookup index. Names contain 1–80 characters. Update a page's assignments transactionally. Back up version-1 libraries before the additive migration; existing note text and image data are unchanged. Backup and relocation include both tables.
- Expose TODOs and Bookmarks in the sidebar and command palette; expose Bookmark this page beside the date controls. Include examples and instructions in Help and the bundled User Guide.

## Implemented enhancement: global quick capture

Use Tauri's global-shortcut plugin from Rust to register a configurable show/hide shortcut. Default: Control+Alt+Space (Control+Option+Space on macOS). A press brings an unfocused/hidden/minimized window forward and focuses the editor. A press while focused asks the frontend to flush pending edits before hiding; a failed save leaves the window visible. Handle key-down only and ignore repeats until release.

Store the chosen shortcut in application preferences, independently of the library. Settings supports changing or disabling it and displays registration errors. Register a replacement before releasing the old binding so conflicts do not silently disable the working shortcut. Include Help and User Guide instructions. The app must remain running; Quit unregisters its shortcut. Native support: macOS, Windows, Linux/X11. Wayland needs a desktop-configured launch/activation shortcut until a portal integration is added.
