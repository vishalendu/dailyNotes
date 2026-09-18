import {
  createIcons,
  Search,
  Command,
  Settings,
  HelpCircle,
  ArrowLeft,
  ArrowRight,
  Archive,
  CalendarDays,
  X,
  Plus,
  ArrowUpRight,
  Folder,
  Download,
  Check,
  ChevronDown,
  FileText,
  Clock,
  Copy,
  RefreshCw,
  ImagePlus,
  Sun,
  Moon,
  Ellipsis,
  NotebookPen,
  Keyboard,
  Sparkles,
  Bookmark,
  ListTodo,
} from "lucide";
export const $ = <T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document,
) => {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
};
export const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const icons = () =>
  createIcons({
    icons: {
      Search,
      Command,
      Settings,
      HelpCircle,
      ArrowLeft,
      ArrowRight,
      Archive,
      CalendarDays,
      X,
      Plus,
      ArrowUpRight,
      Folder,
      Download,
      Check,
      ChevronDown,
      FileText,
      Clock,
      Copy,
      RefreshCw,
      ImagePlus,
      Sun,
      Moon,
      Ellipsis,
      NotebookPen,
      Keyboard,
      Sparkles,
      Bookmark,
      ListTodo,
    },
  });
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const dateLabel = (
  day: string,
  options: Intl.DateTimeFormatOptions = {
    month: "long",
    day: "numeric",
    year: "numeric",
  },
) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, options);
export const mac = /Mac/.test(navigator.platform);
export const mod = mac ? "⌘" : "Ctrl";
export function notify(message: string, error = false) {
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (dialog) {
    let notice = dialog.querySelector<HTMLElement>("[data-notice]");
    if (!notice) {
      notice = document.createElement("p");
      notice.dataset.notice = "";
      notice.setAttribute("role", "status");
      (dialog.querySelector(".dialog-body") ?? dialog).append(notice);
    }
    notice.className = error ? "inline-error" : "muted";
    notice.textContent = message;
    return;
  }
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", error);
  el.hidden = false;
  clearTimeout(Number(el.dataset.timer));
  el.dataset.timer = String(
    setTimeout(() => (el.hidden = true), error ? 12000 : 4500),
  );
}
export function showDialog(title: string, content: string): HTMLDialogElement {
  const dialog = $<HTMLDialogElement>("#dialog");
  if (dialog.open) dialog.close();
  dialog.innerHTML = `<div class="dialog-heading"><h2>${escape(title)}</h2><button class="icon-button" aria-label="Close dialog" data-close><i data-lucide="x"></i></button></div><div class="dialog-body">${content}</div>`;
  $("[data-close]", dialog).onclick = () => dialog.close();
  dialog.showModal();
  icons();
  return dialog;
}
export function ask(
  title: string,
  message: string,
  label = "Continue",
): Promise<boolean> {
  return new Promise((resolve) => {
    const d = showDialog(
      title,
      `<p>${escape(message)}</p><div class="actions"><button class="button" id="cancel">Cancel</button><button class="button primary" id="confirm">${escape(label)}</button></div>`,
    );
    let answer = false;
    $("#cancel", d).onclick = () => d.close();
    $("#confirm", d).onclick = () => {
      answer = true;
      d.close();
    };
    d.addEventListener("close", () => resolve(answer), { once: true });
  });
}
