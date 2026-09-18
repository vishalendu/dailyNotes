import { api } from "./api";
import { $, escape, dateLabel, icons, notify } from "./ui";
import type { Hit, SearchOptions } from "./types";
export class SearchPanel {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private results: Hit[] = [];
  private options: SearchOptions = {
    query: "",
    archived: false,
    days: 30,
    mode: "combined",
    newest: false,
    limit: 21,
  };
  constructor(
    private panel: HTMLElement,
    private libraryId: () => string,
    private flush: () => Promise<void>,
    private openNote: (hit: Hit) => Promise<void>,
  ) {}
  async open(archived = false, history = false) {
    await this.flush();
    this.options = {
      ...this.options,
      archived,
      query: "",
      days: archived || history ? null : 30,
      limit: 21,
      mode: history ? "keywords" : "combined",
      newest: history,
    };
    this.panel.hidden = false;
    this.panel.innerHTML = `<div class="panel-title"><div><span class="eyebrow">${archived ? "THE ARCHIVE" : history ? "YOUR PAGES" : "FIND A THOUGHT"}</span><h2>${archived ? "Search archive" : history ? "History" : "Search notes"}</h2></div><button class="icon-button" id="close-search" aria-label="Close search"><i data-lucide="x"></i></button></div><label class="search-box"><i data-lucide="search"></i><input id="search-input" placeholder="Words, ideas, things you remember…" aria-label="Search notes"></label><div class="search-filters"><select id="search-days" aria-label="Date range"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom days…</option><option value="all">All time</option></select><select id="search-mode" aria-label="Search mode"><option value="combined">Words + meaning</option><option value="keywords">Keywords</option><option value="meaning">Meaning</option></select><select id="search-sort" aria-label="Sort results"><option value="best">Best match</option><option value="newest">Newest first</option></select></div><div class="custom-days" hidden><input type="number" min="1" max="365000" value="60" aria-label="Number of days"><span>days including today</span></div><p class="search-status" role="status"></p><div class="results"></div><button class="button load-more" hidden>Load more</button>`;
    $<HTMLSelectElement>("#search-days", this.panel).value =
      this.options.days === null ? "all" : String(this.options.days);
    $<HTMLSelectElement>("#search-mode", this.panel).value = this.options.mode;
    $<HTMLSelectElement>("#search-sort", this.panel).value = this.options.newest
      ? "newest"
      : "best";
    $("#close-search", this.panel).onclick = () => this.close();
    $<HTMLInputElement>("#search-input", this.panel).oninput = () => {
      this.options.query = $<HTMLInputElement>(
        "#search-input",
        this.panel,
      ).value;
      this.schedule();
    };
    $("#search-days", this.panel).onchange = () => {
      const value = $<HTMLSelectElement>("#search-days", this.panel).value;
      $(".custom-days", this.panel).hidden = value !== "custom";
      this.options.days =
        value === "all" ? null : value === "custom" ? 60 : Number(value);
      this.schedule();
    };
    $(".custom-days input", this.panel).oninput = () => {
      const n = Number(
        $<HTMLInputElement>(".custom-days input", this.panel).value,
      );
      if (Number.isInteger(n) && n > 0 && n <= 365000) {
        this.options.days = n;
        this.schedule();
      }
    };
    $("#search-mode", this.panel).onchange = () => {
      this.options.mode = $<HTMLSelectElement>("#search-mode", this.panel)
        .value as SearchOptions["mode"];
      this.schedule();
    };
    $("#search-sort", this.panel).onchange = () => {
      this.options.newest =
        $<HTMLSelectElement>("#search-sort", this.panel).value === "newest";
      this.schedule();
    };
    $(".load-more", this.panel).onclick = () => {
      this.options.limit += 20;
      void this.run();
    };
    icons();
    $<HTMLInputElement>("#search-input", this.panel).focus();
    await this.run();
  }
  close() {
    this.generation++;
    clearTimeout(this.timer);
    this.panel.hidden = true;
  }
  private schedule() {
    this.generation++;
    this.options.limit = 21;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), 180);
  }
  private async run() {
    const generation = ++this.generation,
      options = { ...this.options };
    $(".search-status", this.panel).textContent = "Searching…";
    try {
      await this.flush();
      if (generation !== this.generation) return;
      if (options.mode === "combined" && options.query.trim()) {
        const hits = await api.search(
          { ...options, mode: "keywords" },
          this.libraryId(),
        );
        if (generation !== this.generation) return;
        this.render(hits);
        $(".search-status", this.panel).textContent =
          "Keyword results ready · looking for related ideas…";
      }
      const hits = await api.search(options, this.libraryId());
      if (generation !== this.generation) return;
      this.render(hits);
      $(".search-status", this.panel).textContent =
        `${Math.min(hits.length, options.limit - 1)} ${options.archived ? "archived " : ""}pages${hits.length >= options.limit ? " · more available" : ""}`;
    } catch (e) {
      if (generation !== this.generation) return;
      $(".search-status", this.panel).textContent = String(e);
      if (options.mode !== "combined") this.render([]);
    }
  }
  private render(hits: Hit[]) {
    this.results = hits.slice(0, this.options.limit - 1);
    $(".results", this.panel).innerHTML = this.results.length
      ? this.results
          .map(
            (h, i) =>
              `<button class="result" data-result="${i}"><div class="result-date"><i data-lucide="file-text"></i><strong>${escape(dateLabel(h.day))}</strong><i data-lucide="arrow-up-right"></i></div><p>${escape(h.snippet || "An empty page")}</p></button>`,
          )
          .join("")
      : `<div class="empty-state"><i data-lucide="search"></i><h3>No pages found</h3><p>Try another phrase or expand the date range.</p><button class="button" id="all-time">Search all time</button>${!this.options.archived ? '<button class="text-button" id="search-archive-link">Search the archive</button>' : ""}</div>`;
    this.panel.querySelectorAll<HTMLElement>("[data-result]").forEach(
      (b) =>
        (b.onclick = () => {
          this.openNote(this.results[Number(b.dataset.result)]).catch((e) =>
            notify(String(e), true),
          );
        }),
    );
    const all = this.panel.querySelector<HTMLElement>("#all-time");
    if (all)
      all.onclick = () => {
        this.options.days = null;
        $<HTMLSelectElement>("#search-days", this.panel).value = "all";
        void this.run();
      };
    const archive = this.panel.querySelector<HTMLElement>(
      "#search-archive-link",
    );
    if (archive)
      archive.onclick = () => {
        const query = this.options.query;
        void this.open(true).then(() => {
          this.options.query = query;
          $<HTMLInputElement>("#search-input", this.panel).value = query;
          this.schedule();
        });
      };
    $(".load-more", this.panel).hidden = hits.length < this.options.limit;
    icons();
  }
}
