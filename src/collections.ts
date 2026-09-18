import { api } from "./api";
import { $, escape, dateLabel, icons, notify, showDialog } from "./ui";
import type { CollectionSearch, Hit } from "./types";

export class Collections {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private panel: HTMLElement,
    private libraryId: () => string,
    private day: () => string,
    private flush: () => Promise<void>,
    private openNote: (hit: Hit) => Promise<void>,
    private refreshLabels: () => Promise<void>,
  ) {}
  close() {
    this.generation++;
    clearTimeout(this.timer);
    this.panel.hidden = true;
  }
  async open(kind: "todos" | "bookmarks") {
    this.close();
    const generation = this.generation;
    await this.flush();
    const libraryId = this.libraryId();
    const bookmarks =
      kind === "bookmarks" ? await api.bookmarks(this.day(), libraryId) : [];
    if (generation !== this.generation) return;
    const options: CollectionSearch = {
      kind,
      query: "",
      days: kind === "todos" ? 7 : null,
      archived: false,
      bookmark_id: null,
      limit: 101,
    };
    this.panel.hidden = false;
    this.panel.innerHTML = `<div class="panel-title"><div><span class="eyebrow">${kind === "todos" ? "WHAT NEEDS DOING" : "YOUR COLLECTIONS"}</span><h2>${kind === "todos" ? "TODOs" : "Bookmarks"}</h2></div><button class="icon-button" data-close aria-label="Close collection"><i data-lucide="x"></i></button></div><p class="muted">${kind === "todos" ? "Lines tagged #todo or #TODO, newest first." : "Group pages with one or more named bookmarks."}</p><input class="field" data-query aria-label="Search ${kind === "todos" ? "TODOs" : "bookmarked notes"}" placeholder="Filter by text…"><div class="search-filters"><label>Last <input class="field" data-days type="number" min="1" max="365000" value="${options.days ?? ""}" placeholder="All" aria-label="Collection days"> days</label><select data-scope aria-label="Collection scope"><option value="active">Active notes</option><option value="archive">Archive only</option></select></div>${kind === "bookmarks" ? `<select class="field" data-bookmark aria-label="Filter bookmark"><option value="">All bookmarks</option>${bookmarks.map((b) => `<option value="${b.id}">${escape(b.name)}</option>`).join("")}</select><button class="button" data-edit>Bookmark this page</button>` : ""}<p class="search-status" role="status"></p><div class="results"></div><button class="button load-more" hidden>Load more</button>`;
    $("[data-close]", this.panel).onclick = () => this.close();
    let request = 0;
    const run = async () => {
      const current = ++request;
      const status = $(".search-status", this.panel);
      try {
        const raw = $<HTMLInputElement>("[data-days]", this.panel).value;
        options.days = raw === "" ? null : Number(raw);
        if (
          options.days !== null &&
          (!Number.isInteger(options.days) ||
            options.days < 1 ||
            options.days > 365000)
        )
          throw new Error(
            "Enter a positive number of days, or leave blank for all time.",
          );
        options.query = $<HTMLInputElement>("[data-query]", this.panel).value;
        options.archived =
          $<HTMLSelectElement>("[data-scope]", this.panel).value === "archive";
        const filter =
          this.panel.querySelector<HTMLSelectElement>("[data-bookmark]");
        options.bookmark_id = filter?.value ? Number(filter.value) : null;
        status.textContent = "Loading…";
        await this.flush();
        if (generation !== this.generation || current !== request) return;
        const hits = await api.collectionHits({ ...options }, libraryId);
        if (generation !== this.generation || current !== request) return;
        const visible = hits.slice(0, options.limit - 1);
        status.textContent = `${visible.length} ${kind === "todos" ? "TODO lines" : "pages"}${hits.length >= options.limit ? " · more available" : ""}`;
        $(".results", this.panel).innerHTML = visible.length
          ? visible
              .map(
                (h, i) =>
                  `<button class="result" data-hit="${i}"><div class="result-date"><strong>${escape(dateLabel(h.day))}</strong><i data-lucide="arrow-up-right"></i></div><p>${escape(h.snippet || "Bookmarked empty page")}</p></button>`,
              )
              .join("")
          : `<p class="muted">${kind === "todos" ? "No TODOs found. Add #todo to a line in your note, or expand the date range." : "No bookmarked pages found. Bookmark this page to get started."}</p>`;
        this.panel
          .querySelectorAll<HTMLElement>("[data-hit]")
          .forEach(
            (b) =>
              (b.onclick = () =>
                void this.openNote(visible[Number(b.dataset.hit)]).catch((e) =>
                  notify(String(e), true),
                )),
          );
        $(".load-more", this.panel).hidden = hits.length < options.limit;
        icons();
      } catch (e) {
        if (generation === this.generation && current === request)
          status.textContent = String(e);
      }
    };
    this.panel
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")
      .forEach(
        (el) =>
          (el.oninput = () => {
            request++;
            options.limit = 101;
            clearTimeout(this.timer);
            this.timer = setTimeout(() => void run(), 180);
          }),
      );
    $(".load-more", this.panel).onclick = () => {
      options.limit += 100;
      void run();
    };
    const edit = this.panel.querySelector<HTMLElement>("[data-edit]");
    if (edit)
      edit.onclick = () =>
        void this.edit()
          .then(() => this.open(kind))
          .catch((e) => notify(String(e), true));
    icons();
    await run();
  }
  async edit() {
    await this.flush();
    const day = this.day(),
      libraryId = this.libraryId();
    let bookmarks = await api.bookmarks(day, libraryId);
    const selected = new Set(
      bookmarks.filter((b) => b.assigned).map((b) => b.id),
    );
    const d = showDialog(
      "Bookmarks for this page",
      `<p>${escape(dateLabel(day))} · Choose any number of bookmarks.</p><div data-bookmark-list></div><form data-create class="button-row"><input class="field" name="name" aria-label="New bookmark name" placeholder="New bookmark, e.g. Work" maxlength="80" required><button class="button" type="submit">Create bookmark</button></form><div class="actions"><button class="button primary" data-apply>Apply bookmarks</button></div>`,
    );
    const render = () => {
      $("[data-bookmark-list]", d).innerHTML =
        bookmarks
          .map(
            (b) =>
              `<label class="switch-row"><span>${escape(b.name)}</span><input type="checkbox" data-id="${b.id}" ${selected.has(b.id) ? "checked" : ""}></label>`,
          )
          .join("") || '<p class="muted">Create your first bookmark below.</p>';
      d.querySelectorAll<HTMLInputElement>("[data-id]").forEach(
        (el) =>
          (el.onchange = () => {
            const id = Number(el.dataset.id);
            if (el.checked) selected.add(id);
            else selected.delete(id);
          }),
      );
    };
    render();
    const form = $<HTMLFormElement>("[data-create]", d);
    const apply = $<HTMLButtonElement>("[data-apply]", d);
    form.onsubmit = (e) => {
      e.preventDefault();
      const input = $<HTMLInputElement>("[name=name]", d);
      const button = $<HTMLButtonElement>("[type=submit]", d);
      button.disabled = true;
      apply.disabled = true;
      void (async () => {
        const id = await api.createBookmark(input.value, libraryId);
        selected.add(id);
        bookmarks = await api.bookmarks(day, libraryId);
        if (!form.isConnected) return;
        input.value = "";
        render();
      })()
        .catch((e) => notify(String(e), true))
        .finally(() => {
          button.disabled = false;
          apply.disabled = false;
        });
    };
    $("[data-apply]", d).onclick = () => {
      const button = $<HTMLButtonElement>("[data-apply]", d);
      button.disabled = true;
      void api
        .assignBookmarks(day, [...selected], libraryId)
        .then(async () => {
          await this.refreshLabels();
          d.close();
          notify("Page bookmarks updated.");
        })
        .catch((e) => notify(String(e), true))
        .finally(() => (button.disabled = false));
    };
    await new Promise<void>((resolve) =>
      d.addEventListener("close", () => resolve(), { once: true }),
    );
  }
}
