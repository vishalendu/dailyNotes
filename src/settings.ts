import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { $, showDialog, escape, notify, ask } from "./ui";
import type { LibraryInfo } from "./types";
export interface SettingsContext {
  info: () => LibraryInfo;
  flush: () => Promise<void>;
  changed: (info: LibraryInfo) => Promise<void>;
  refresh: () => Promise<void>;
}
export class Settings {
  constructor(private context: SettingsContext) {}
  async choose(create: boolean) {
    await this.context.flush();
    const folder = await open(
      create
        ? { directory: true, title: "Choose a folder for your library" }
        : {
            filters: [
              { name: "Daily Notes library", extensions: ["sqlite", "db"] },
            ],
            title: "Open a Daily Notes library",
          },
    );
    if (typeof folder !== "string") return;
    const path = create ? `${folder}/DailyNotes.sqlite` : folder;
    await this.context.changed(await api.choose(path, create));
  }
  async show() {
    await this.context.flush();
    const info = this.context.info();
    const stats = await api.stats();
    const model = await api.model();
    const hotkey = await api.hotkey();
    const d = showDialog(
      "Your space, your settings",
      `<section class="settings-section"><div class="section-label"><i data-lucide="folder"></i><h3>Library</h3></div><p class="path">${escape(info.path ?? "No library selected")}</p><div class="stats"><span><strong>${stats.active}</strong> active pages</span><span><strong>${stats.archived}</strong> archived</span><span><strong>${(stats.bytes / 1024 / 1024).toFixed(1)} MB</strong> on disk</span></div><div class="button-row"><button id="backup" class="button">Back up now</button><button id="move" class="button">Move library</button><button id="open-library" class="button">Open another</button><button id="new-library" class="button">New library</button></div></section><section class="settings-section"><div class="section-label"><i data-lucide="archive"></i><h3>Make room for what’s next</h3></div><p>Archive older pages to keep them out of everyday searches. Nothing is deleted.</p><button id="archive-settings" class="button">Archive older notes</button></section><section class="settings-section"><div class="section-label"><i data-lucide="sparkles"></i><h3>Local meaning search</h3></div><p>${escape(model.message)} · ${stats.pending} pending pages</p><progress max="1" value="${model.progress}"></progress><p class="muted">Saved changes are indexed in 10-minute batches. Your notes never leave this device.</p><div class="button-row"><button id="model-retry" class="button">Retry download</button><button id="model-cancel" class="button">Pause download</button><button id="model-index" class="button">Index pending now</button></div></section><section class="settings-section"><div class="section-label"><i data-lucide="keyboard"></i><h3>Quick capture shortcut</h3></div><p>Bring Daily Notes forward from another app. Press again while focused to save and hide it.</p><label class="form-label">Global shortcut<input id="global-hotkey" class="field" value="${escape(hotkey.shortcut)}" placeholder="Control+Alt+Space"></label><p class="muted">On Mac, Alt means Option. Leave blank to disable. The app must be running.</p><button class="button" id="save-hotkey">Save shortcut</button><p id="hotkey-status" role="status">${escape(hotkey.error ?? (hotkey.registered ? "Shortcut active" : "Shortcut disabled"))}</p></section><section class="settings-section"><label class="switch-row"><span><strong>Keep running in background</strong><small>Closing the window keeps the app in the tray/menu bar.</small></span><input type="checkbox" id="background" ${info.background ? "checked" : ""}></label></section><p class="muted">Daily Notes 0.1 · Local first, quietly useful.</p>`,
    );
    const run = (selector: string, action: () => Promise<unknown>) => {
      $(selector, d).onclick = () =>
        void action().catch((e) => notify(String(e), true));
    };
    run("#save-hotkey", async () => {
      const button = $<HTMLButtonElement>("#save-hotkey", d);
      button.disabled = true;
      try {
        const value = await api.setHotkey(
          $<HTMLInputElement>("#global-hotkey", d).value,
        );
        $("#hotkey-status", d).textContent = value.registered
          ? "Shortcut active"
          : "Shortcut disabled";
      } catch (e) {
        $("#hotkey-status", d).textContent = String(e);
      } finally {
        button.disabled = false;
      }
    });
    run("#backup", () => this.backup());
    run("#move", () => this.move());
    run("#open-library", () => this.choose(false));
    run("#new-library", () => this.choose(true));
    run("#archive-settings", () => this.archive());
    for (const action of ["retry", "cancel", "index"])
      run(`#model-${action}`, async () => {
        await api.modelAction(action);
        notify(action === "index" ? "Indexing queued" : "Model action queued");
      });
    $<HTMLInputElement>("#background", d).onchange = () => {
      const enabled = $<HTMLInputElement>("#background", d).checked;
      api
        .background(enabled)
        .then(() => {
          info.background = enabled;
        })
        .catch((e) => notify(String(e), true));
    };
  }
  async backup() {
    await this.context.flush();
    const path = await save({
      title: "Create a library backup",
      defaultPath: `DailyNotes-backup-${new Date().toISOString().slice(0, 10)}.sqlite`,
      filters: [{ name: "SQLite library", extensions: ["sqlite"] }],
    });
    if (path) {
      await api.backup(path, this.context.info().id!);
      notify("Backup created and verified.");
    }
  }
  async move() {
    await this.context.flush();
    const folder = await open({
      directory: true,
      title: "Move library to folder",
    });
    if (typeof folder === "string") {
      const source = this.context.info().path;
      await this.context.changed(
        await api.move(folder, this.context.info().id!),
      );
      notify(`Library moved. Recovery copy kept at ${source}`);
    }
  }
  async archive() {
    await this.context.flush();
    const info = this.context.info();
    const d = showDialog(
      "Archive older notes",
      `<p>Keep your everyday space focused. Archived pages stay searchable in Search archive.</p><label class="form-label">Archive pages older than<div class="inline-input"><input id="archive-age" type="number" min="1" max="365000" value="${info.archive_days}" class="field"><span>days</span></div></label><p id="archive-count" role="status"></p><div class="actions"><button class="button primary" id="archive-confirm">Archive now</button></div>`,
    );
    let generation = 0;
    const preview = async () => {
      const gen = ++generation;
      try {
        const days = Number($<HTMLInputElement>("#archive-age", d).value);
        if (!Number.isInteger(days) || days < 1)
          throw new Error("Enter a positive whole number of days.");
        const count = await api.archive(days, true, info.id!);
        if (gen !== generation) return;
        $("#archive-count", d).textContent =
          `${count} ${count === 1 ? "page" : "pages"} will move to the archive.`;
        $<HTMLButtonElement>("#archive-confirm", d).disabled = count === 0;
      } catch (e) {
        $("#archive-count", d).textContent = String(e);
        $<HTMLButtonElement>("#archive-confirm", d).disabled = true;
      }
    };
    $("#archive-age", d).oninput = () => void preview();
    await preview();
    $("#archive-confirm", d).onclick = () => {
      void (async () => {
        const count = await api.archive(
          Number($<HTMLInputElement>("#archive-age", d).value),
          false,
          info.id!,
        );
        d.close();
        await this.context.refresh();
        notify(`${count} pages archived. Find them in Search archive.`);
      })().catch((e) => notify(String(e), true));
    };
  }
}
