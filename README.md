# Daily Notes

A lightweight desktop scratchpad for daily work: one page per date, pasted images, searchable history, and developer text tools inspired by [Boop](https://github.com/IvanMathy/Boop).

**Status:** version 0.1 is implemented and smoke-tested on macOS. Windows and Linux builds still need native validation.

## Main features

- Open directly into today's note; keep history out of the way.
- Edit rich notes with bold/italic text, headings, lists, quotes, links, inline code, and code blocks; save text and images automatically to SQLite.
- Choose fonts, font size, line height, and paragraph spacing, with compact defaults and system-font fallbacks.
- Paste supported formatting normally, or use Cmd/Ctrl+Shift+V, right-click, or the palette to paste without formatting.
- Search by keywords or meaning, with dated snippets and filters for recent days.
- Glance at `#todo` / `#TODO` lines from the last 7 days, or choose another range and filter by text.
- Create named bookmarks, apply multiple bookmarks to a page, and browse their pages.
- Bring the app forward or save and hide it with a configurable global shortcut (default Ctrl+Alt+Space; macOS Control+Option+Space). Supported on macOS, Windows, and Linux/X11.
- Archive notes older than a configurable age, defaulting to 90 days; search the archive separately.
- Format JSON, encode/decode text, sort lines, and use other developer utilities from a command palette.
- Download the embedding model once, run it locally when needed, and release it after use.
- Access Help, User Guide, and Keyboard Shortcuts from the palette or a visible Help button.

The desktop stack is Tauri, TypeScript, Rust, SQLite, and local ONNX inference, targeting macOS, Windows, and Linux. Note saving is independent of semantic indexing, which batches pending changes every 10 minutes.

## Writing and formatting

Use **Aa** beside the date controls or the command palette for formatting. Markdown-style typing shortcuts format text directly (`# `, `- `, `**bold**`, or a backtick fence). To convert pasted Markdown, select it and run **Convert selection from Markdown**. The editor shows the formatted result as you edit; there is no separate source/preview pane.

Use **Aa** on the note page for fonts, size, spacing, and formatting. Font/size changes affect selected text, or subsequent typing at the cursor. Spacing affects the selected paragraphs. Choose generic families or installed fonts, preview, then Apply; mixed selections display Mixed. There is no global typography setting. Unstyled text defaults to 14px, line height 1.4, and zero extra paragraph spacing. Code retains monospace styling. Old machine-local appearance preferences are retired without rewriting notes.

Missing custom fonts fall back to the default system sans-serif, while the saved font name and formatting remain intact. Known symbol fonts such as Wingdings/Webdings are excluded from the picker; imported content using a missing symbol font shows a warning because ordinary font fallback cannot preserve its symbols. Use Unicode symbols or images for portability. Unknown custom symbol fonts cannot all be detected.

Normal paste keeps supported formatting but preserves validated font/size styles while stripping source spacing, scripts, and remote images. **Paste without formatting** preserves text, blank lines, and indentation without styling or Markdown conversion. Code blocks always accept literal plain text. The native desktop shortcut is **Cmd+Shift+V** on Mac or **Ctrl+Shift+V** on Windows/Linux; right-click and palette actions are available too. Native clipboard testing on Windows/Linux is still pending.

Library schema v4 stores compressed rich-document JSON in SQLite with a searchable text projection. Document format v2 retains per-selection typography; legacy and v1 notes remain readable and unchanged until edited. A verified `pre-v4` database backup is saved alongside an existing library before upgrading. Older app builds cannot open a v4 library; use the backup for rollback. Emergency export includes a readable text copy, structured JSON, and images.

## Documentation

- [User Guide](docs/user-guide.md): workflows and feature explanations, also bundled in the app.
- [Product and architecture specification](spec.md): stack, data model, behavior, implementation milestones, and acceptance checks.
- [App icon](assets/daily-notes-icon.png) and [generation prompt](assets/icon-prompt.md).

## Build from source

These prerequisites are for developers building the app. A packaged desktop app does **not** require Rust, Node.js, Python, or Ollama.

### 1. Install prerequisites

- **Git** to clone the repository.
- **Node.js 22.12+** (or a newer supported LTS release) and npm. Check with `node --version` and `npm --version`.
- **Rust stable** via [rustup](https://rustup.rs/), including Cargo. Check with `rustc --version` and `cargo --version`. Run `rustup update stable` for an existing installation; the repository selects stable through `rust-toolchain.toml`.
- Your platform's native build tools:

| Platform | Required setup |
| --- | --- |
| macOS | Xcode Command Line Tools: run `xcode-select --install`. Full Xcode may be needed for signing/distribution. |
| Windows | Microsoft C++ Build Tools with the Desktop development with C++ workload and a Windows SDK; Microsoft Edge WebView2 Runtime. Use the Rust MSVC toolchain matching your architecture. |
| Linux | C/C++ build tools, pkg-config, FreeType/Fontconfig development files, WebKitGTK 4.1, GTK 3, OpenSSL development files, librsvg, and an AppIndicator development package for the tray. Package names depend on the distribution. |

For Debian/Ubuntu, the Tauri prerequisites typically install with:

```sh
sudo apt update
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev libfreetype6-dev libfontconfig1-dev patchelf
```

Check [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your distribution and supported versions. Build each platform's installer on that platform; a macOS build does not produce Windows/Linux installers.

### 2. Install dependencies

From the repository root:

```sh
npm ci
```

The first desktop build also downloads Rust dependencies and the matching ONNX inference runtime. Internet access and several GB of free disk space for compiler dependencies/build artifacts are needed. SQLite is bundled; do not install a separate database server. Model weights are downloaded separately by the app and are not checked into Git.

### 3. Run the desktop app

```sh
npm run desktop
```

This starts both the Vite frontend and the Rust/Tauri desktop host. `npm run dev` alone starts only the frontend and is not a replacement for the desktop app or its SQLite storage.

### 4. Verify and build

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build
```

Packaged artifacts are written under `src-tauri/target/release/bundle/`. For a macOS `.app` without building a disk image, use `npm run desktop:build`. Distribution signing/notarization requires your own platform credentials; local development does not.

### First use

Choose a library location or open an existing library. Notes are stored in SQLite, not Markdown. The model downloads in the background on first use; writing and keyword search work without it, and semantic search works offline once the download finishes. Consult the [User Guide](docs/user-guide.md) for storage, backups, and command-palette shortcuts.

Downloaded model weights stay outside Git. Never commit a personal notes database or signing credentials.

## Basic checks

The smoke tests cover rich-document/image round trips, legacy-library upgrades and verified backups, malformed document/link rejection, nested TODO offsets, rich/plain paste, fonts and spacing, code-block transformations and undo, document/image references, JSON and text tools, SQLite saves and revision conflicts, keyword search, date/archive filtering, image deduplication, backups, and moving libraries. The browser checks cover the editor, palette, help, theme, and first-launch creation/closing with mocked desktop IPC.

For the browser checks, install Chrome, start `npm run dev` in another terminal, then run `npm exec playwright test`. To verify actual local model download, inference, indexing, and semantic retrieval, run `cargo test --manifest-path src-tauri/Cargo.toml model_smoke -- --ignored --nocapture`. This downloads about 91 MB into the ignored `models/smoke/` directory.

The frontend modules live in `src/`; desktop storage, library management, image handling, commands, and embeddings are separate modules in `src-tauri/src/`. Semantic retrieval currently scans eligible vectors exactly; very large libraries may eventually need an approximate vector index. Signing, automatic updates, and launch-at-login setup are not included in this version.

## Credits

Created by [Vishalendu Pandey](https://github.com/vishalendu), with implementation and testing assistance from **OpenAI Codex**, an AI coding assistant.

Developer text utilities are inspired by [Boop](https://github.com/IvanMathy/Boop). The app uses its own implementations of these utilities. The notepad icon was generated with OpenAI image generation; its prompt is recorded in `assets/icon-prompt.md`.
