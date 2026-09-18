import DOMPurify from "dompurify";
import { marked } from "marked";
import guide from "../docs/user-guide.md?raw";
import { $, showDialog, escape, mod } from "./ui";
import type { Command } from "./types";
export function showHelp(
  kind: "help" | "guide" | "shortcuts",
  commands: Command[],
) {
  if (kind === "shortcuts") {
    showDialog(
      "Keyboard shortcuts",
      `<p class="muted">A few shortcuts to keep you in flow.</p><div class="shortcut-list">${commands
        .filter((c) => c.shortcut)
        .map(
          (c) =>
            `<div><span>${escape(c.title)}</span><kbd>${escape(c.shortcut!)}</kbd></div>`,
        )
        .join(
          "",
        )}<div><span>Save now</span><kbd>${mod} S</kbd></div><div><span>Find in this note</span><kbd>${mod} F</kbd></div><div><span>Close a panel</span><kbd>Esc</kbd></div></div>`,
    );
    return;
  }
  if (kind === "help") {
    const d = showDialog(
      "A little space for your day.",
      `<p>Write a thought, paste a snippet, drop in a screenshot. Daily Notes keeps it all in one place, one day at a time.</p><div class="help-grid"><div><i data-lucide="calendar-days"></i><h3>Start with today</h3><p>Your page saves automatically. Yesterday is just a date away.</p></div><div><i data-lucide="search"></i><h3>Find it again</h3><p>Search words or meaning. Narrow by date, or explore your archive.</p></div><div><i data-lucide="command"></i><h3>Make quick work</h3><p>Format JSON and find every tool with ${mod} ⇧ P.</p></div><div><i data-lucide="list-todo"></i><h3>TODOs at a glance</h3><p>Add #todo or #TODO to a line. Open TODOs to see the last 7 days, change the range, or filter by text.</p></div><div><i data-lucide="bookmark"></i><h3>Bookmark your pages</h3><p>Use the bookmark icon beside the date to create and assign several named bookmarks. Browse them from the sidebar or palette.</p></div><div><i data-lucide="keyboard"></i><h3>Quick capture</h3><p>Ctrl+Alt+Space (Control+Option+Space on Mac) brings the app forward or saves and hides it. Change the global shortcut in Settings; the app must stay running.</p></div><div><i data-lucide="folder"></i><h3>Yours, locally</h3><p>Your notes and images live in your chosen SQLite library.</p></div></div><div class="actions"><button class="button" id="help-shortcuts">Keyboard shortcuts</button><button class="button primary" id="help-guide">Read the user guide <i data-lucide="arrow-up-right"></i></button></div>`,
    );
    $("#help-guide", d).onclick = () => showHelp("guide", commands);
    $("#help-shortcuts", d).onclick = () => showHelp("shortcuts", commands);
    return;
  }
  const html = DOMPurify.sanitize(marked.parse(guide, { async: false }), {
    FORBID_TAGS: ["img", "iframe", "style"],
  });
  const d = showDialog(
    "User guide",
    `<input id="guide-find" class="field" placeholder="Find a topic…" aria-label="Find a guide topic"><nav class="guide-contents"></nav><article class="guide">${html}</article>`,
  );
  const headings = Array.from(d.querySelectorAll<HTMLElement>("article h2"));
  headings.forEach((h, i) => (h.id = `guide-topic-${i}`));
  $(".guide-contents", d).innerHTML = headings
    .map(
      (h, i) =>
        `<button data-topic="${i}">${escape(h.textContent ?? "")}</button>`,
    )
    .join("");
  d.querySelectorAll<HTMLElement>("[data-topic]").forEach(
    (b) =>
      (b.onclick = () =>
        headings[Number(b.dataset.topic)].scrollIntoView({
          behavior: "smooth",
          block: "start",
        })),
  );
  $("#guide-find", d).addEventListener("input", () => {
    const q = $<HTMLInputElement>("#guide-find", d).value.toLowerCase();
    d.querySelectorAll<HTMLElement>("[data-topic]").forEach(
      (b) => (b.hidden = !b.textContent?.toLowerCase().includes(q)),
    );
  });
}
