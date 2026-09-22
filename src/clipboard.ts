import { parseFont, fontCSS, validSize } from "./appearance";
import DOMPurify from "dompurify";
import { marked } from "marked";
export const plainText = (s: string) =>
  s.replace(/\r\n?/g, "\n").replaceAll("\uFFFC", "�");
export const safeLink = (s: string) =>
  /^(https?:\/\/|mailto:)/i.test(s.trim()) && !/[\u0000-\u001f\u007f]/.test(s);
export function cleanHtml(html: string): string {
  // No image tags are parsed: external HTML cannot fetch images or claim database IDs.
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "div",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "s",
      "strike",
      "del",
      "code",
      "pre",
      "h1",
      "h2",
      "h3",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
      "span",
    ],
    ALLOWED_ATTR: ["href", "start", "style"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  doc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    const font = parseFont(el.style.fontFamily);
    const size = el.style.fontSize;
    el.removeAttribute("style");
    if (el.closest("pre,code")) return;
    const styles = [
      font ? `font-family: ${fontCSS(font)}` : "",
      validSize(size) ? `font-size: ${size}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    if (!styles) return;
    if (el.tagName === "SPAN") el.setAttribute("style", styles);
    else if (
      [
        "P",
        "DIV",
        "H1",
        "H2",
        "H3",
        "STRONG",
        "B",
        "EM",
        "I",
        "S",
        "A",
      ].includes(el.tagName) &&
      !el.querySelector("p,div,ul,ol,pre,blockquote,h1,h2,h3")
    ) {
      const span = doc.createElement("span");
      span.setAttribute("style", styles);
      span.append(...Array.from(el.childNodes));
      el.append(span);
    }
  });
  doc.querySelectorAll("a").forEach((a) => {
    if (!safeLink(a.getAttribute("href") ?? "")) a.removeAttribute("href");
  });
  doc.querySelectorAll("ol[start]").forEach((el) => {
    const n = Number(el.getAttribute("start"));
    if (!Number.isInteger(n) || n < 1 || n > 1e9) el.removeAttribute("start");
  });
  return doc.body.innerHTML;
}
export function markdownHtml(text: string): string {
  return cleanHtml(marked.parse(text, { async: false }));
}
