# Daily Notes

A lightweight desktop scratchpad for daily work: one page per date, pasted images, searchable history, and developer text tools inspired by [Boop](https://github.com/IvanMathy/Boop).

**Status:** version 0.1 is implemented and smoke-tested on macOS. Windows and Linux builds still need native validation.

## Main features

- Open directly into today's note; keep history out of the way.
- Paste text and images, with automatic saving to a user-located SQLite database.
- Search by keywords or meaning, with dated snippets and filters for recent days.
- Glance at `#todo` / `#TODO` lines from the last 7 days, or choose another range and filter by text.
- Create named bookmarks, apply multiple bookmarks to a page, and browse their pages.
- Bring the app forward or save and hide it with a configurable global shortcut (default Ctrl+Alt+Space; macOS Control+Option+Space). Supported on macOS, Windows, and Linux/X11.
- Archive notes older than a configurable age, defaulting to 90 days; search the archive separately.
- Format JSON, encode/decode text, sort lines, and use other developer utilities from a command palette.
- Download the embedding model once, run it locally when needed, and release it after use.
- Access Help, User Guide, and Keyboard Shortcuts from the palette or a visible Help button.

The desktop stack is Tauri, TypeScript, Rust, SQLite, and local ONNX inference, targeting macOS, Windows, and Linux. Note saving is independent of semantic indexing, which batches pending changes every 10 minutes.

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
| Linux | C/C++ build tools, pkg-config, WebKitGTK 4.1, GTK 3, OpenSSL development files, librsvg, and an AppIndicator development package for the tray. Package names depend on the distribution. |

For Debian/Ubuntu, the Tauri prerequisites typically install with:

```sh
sudo apt update
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev patchelf
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

The smoke tests cover document/image references, JSON and text tools, SQLite saves and revision conflicts, keyword search, date/archive filtering, image deduplication, backups, and moving libraries. The browser checks cover the editor, palette, help, theme, and first-launch creation/closing with mocked desktop IPC.

For the browser checks, install Chrome, start `npm run dev` in another terminal, then run `npm exec playwright test`. To verify actual local model download, inference, indexing, and semantic retrieval, run `cargo test --manifest-path src-tauri/Cargo.toml model_smoke -- --ignored --nocapture`. This downloads about 91 MB into the ignored `models/smoke/` directory.

The frontend modules live in `src/`; desktop storage, library management, image handling, commands, and embeddings are separate modules in `src-tauri/src/`. Semantic retrieval currently scans eligible vectors exactly; very large libraries may eventually need an approximate vector index. Signing, automatic updates, and launch-at-login setup are not included in this version.

## Credits

Created by [Vishalendu Pandey](https://github.com/vishalendu), with implementation and testing assistance from **OpenAI Codex**, an AI coding assistant.

Developer text utilities are inspired by [Boop](https://github.com/IvanMathy/Boop). The app uses its own implementations of these utilities. The notepad icon was generated with OpenAI image generation; its prompt is recorded in `assets/icon-prompt.md`.
