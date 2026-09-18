import type { Command } from "./types";
import { $, escape, icons, notify } from "./ui";
export class Palette {
  private commands: Command[] = [];
  private filtered: Command[] = [];
  private selected = 0;
  constructor(private dialog: HTMLDialogElement) {
    dialog.innerHTML = `<div class="palette-input"><i data-lucide="search"></i><input aria-label="Search commands" placeholder="What would you like to do?" autocomplete="off"><kbd>esc</kbd></div><div class="palette-list" role="listbox" aria-label="Commands"></div><div class="palette-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> to navigate</span><span><kbd>↵</kbd> to run</span></div>`;
    $("input", dialog).addEventListener("input", () => this.filter());
    dialog.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        this.selected =
          (this.selected +
            (event.key === "ArrowDown" ? 1 : -1) +
            this.filtered.length) %
          Math.max(1, this.filtered.length);
        this.render();
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.run(this.selected);
      }
    });
    dialog.addEventListener("click", (event) => {
      const b = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-index]",
      );
      if (b) this.run(Number(b.dataset.index));
    });
  }
  set(commands: Command[]) {
    this.commands = commands;
  }
  open(query = "") {
    this.dialog.showModal();
    $<HTMLInputElement>("input", this.dialog).value = query;
    this.filter();
    $<HTMLInputElement>("input", this.dialog).focus();
  }
  private filter() {
    const q = $<HTMLInputElement>("input", this.dialog).value.toLowerCase();
    this.filtered = this.commands.filter((c) =>
      `${c.title} ${c.description} ${c.aliases ?? ""}`
        .toLowerCase()
        .includes(q),
    );
    this.selected = 0;
    this.render();
  }
  private render() {
    let group = "";
    $(".palette-list", this.dialog).innerHTML =
      this.filtered
        .map((c, i) => {
          const heading =
            c.group !== group
              ? `<div class="palette-group">${escape(c.group)}</div>`
              : "";
          group = c.group;
          return `${heading}<button id="command-${i}" role="option" aria-selected="${i === this.selected}" data-index="${i}" class="palette-command ${i === this.selected ? "selected" : ""}"><span><strong>${escape(c.title)}</strong><small>${escape(c.description)}</small></span>${c.shortcut ? `<kbd>${escape(c.shortcut)}</kbd>` : '<i data-lucide="arrow-up-right"></i>'}</button>`;
        })
        .join("") || '<p class="empty">No commands found.</p>';
    icons();
    this.dialog
      .querySelector(".selected")
      ?.scrollIntoView({ block: "nearest" });
  }
  private run(index: number) {
    const command = this.filtered[index];
    if (!command) return;
    this.dialog.close();
    Promise.resolve()
      .then(() => command.run())
      .catch((e) => notify(String(e), true));
  }
}
