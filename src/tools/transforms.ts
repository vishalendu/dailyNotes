import {
  parseTree,
  format,
  applyEdits,
  createScanner,
  SyntaxKind,
  type Node,
  type ParseError,
} from "jsonc-parser";
import { decodeHTML, escapeText } from "entities";
const decoder = new TextDecoder("utf-8", { fatal: true });
function json(input: string) {
  const errors: ParseError[] = [];
  const tree = parseTree(input, errors, {
    disallowComments: true,
    allowTrailingComma: false,
  });
  if (!tree || errors.length)
    throw new Error(
      `Invalid JSON near character ${(errors[0]?.offset ?? 0) + 1}. Your text was not changed.`,
    );
  return tree;
}
function sorted(node: Node, input: string): string {
  if (node.type === "object") {
    const keys = new Set<string>();
    const children = [...(node.children ?? [])];
    for (const p of children) {
      const k = String(p.children![0].value);
      if (keys.has(k)) throw new Error(`Duplicate JSON key: ${k}`);
      keys.add(k);
    }
    children.sort((a, b) =>
      String(a.children![0].value).localeCompare(String(b.children![0].value)),
    );
    return `{${children.map((p) => `${JSON.stringify(p.children![0].value)}:${sorted(p.children![1], input)}`).join(",")}}`;
  }
  if (node.type === "array")
    return `[${(node.children ?? []).map((n) => sorted(n, input)).join(",")}]`;
  return input.slice(node.offset, node.offset + node.length);
}
function base64decode(input: string) {
  const clean = input.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0)
    throw new Error("Invalid Base64 text.");
  return decoder.decode(Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)));
}
function words(text: string) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
export async function transform(id: string, input: string): Promise<string> {
  if (new TextEncoder().encode(input).length > 1024 * 1024)
    throw new Error("Select less than 1 MiB of text.");
  const lines = () => input.split(/\r?\n/);
  switch (id) {
    case "json-format":
      json(input);
      return applyEdits(
        input,
        format(input, undefined, { insertSpaces: true, tabSize: 2, eol: "\n" }),
      );
    case "json-minify": {
      json(input);
      const scanner = createScanner(input, false);
      let result = "";
      for (let t = scanner.scan(); t !== SyntaxKind.EOF; t = scanner.scan()) {
        if (t !== SyntaxKind.Trivia && t !== SyntaxKind.LineBreakTrivia)
          result += input.slice(
            scanner.getTokenOffset(),
            scanner.getTokenOffset() + scanner.getTokenLength(),
          );
      }
      return result;
    }
    case "json-validate":
      json(input);
      return "Valid JSON. No changes made.";
    case "json-sort":
      return transform("json-format", sorted(json(input), input));
    case "base64-encode": {
      const bytes = new TextEncoder().encode(input);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    }
    case "base64-decode":
      return base64decode(input);
    case "url-encode":
      return encodeURIComponent(input);
    case "url-decode":
      return decodeURIComponent(input);
    case "html-encode":
      return escapeText(input)
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    case "html-decode":
      return decodeHTML(input);
    case "upper":
      return input.toLocaleUpperCase();
    case "lower":
      return input.toLocaleLowerCase();
    case "camel":
      return words(input)
        .map((w, i) =>
          i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase(),
        )
        .join("");
    case "snake":
      return words(input)
        .map((w) => w.toLowerCase())
        .join("_");
    case "kebab":
      return words(input)
        .map((w) => w.toLowerCase())
        .join("-");
    case "sort":
      return lines()
        .sort((a, b) => a.localeCompare(b))
        .join("\n");
    case "sort-desc":
      return lines()
        .sort((a, b) => b.localeCompare(a))
        .join("\n");
    case "sort-natural":
      return lines()
        .sort(new Intl.Collator(undefined, { numeric: true }).compare)
        .join("\n");
    case "dedup":
      return [...new Set(lines())].join("\n");
    case "trim":
      return lines()
        .map((l) => l.trimEnd())
        .join("\n");
    case "remove-empty":
      return lines()
        .filter((l) => l.trim())
        .join("\n");
    case "join":
      return lines().join(" ");
    case "count":
      return `${[...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(input)].length} characters\n${[...new Intl.Segmenter(undefined, { granularity: "word" }).segment(input)].filter((w) => w.isWordLike).length} words\n${input ? lines().length : 0} lines`;
    case "jwt": {
      const parts = input.trim().split(".");
      if (parts.length !== 3)
        throw new Error("Expected a JWT with three dot-separated segments.");
      const read = (part: string) => {
        const b = part.replaceAll("-", "+").replaceAll("_", "/");
        return JSON.parse(
          base64decode(b.padEnd(Math.ceil(b.length / 4) * 4, "=")),
        );
      };
      return `SIGNATURE NOT VERIFIED\n\nHeader\n${JSON.stringify(read(parts[0]), null, 2)}\n\nPayload\n${JSON.stringify(read(parts[1]), null, 2)}`;
    }
    case "timestamp-seconds":
    case "timestamp-ms": {
      if (!/^-?\d+$/.test(input.trim()))
        throw new Error("Enter an integer Unix timestamp.");
      const d = new Date(
        Number(input) * (id === "timestamp-seconds" ? 1000 : 1),
      );
      if (!Number.isFinite(d.getTime()))
        throw new Error("Timestamp is outside the supported date range.");
      return d.toISOString();
    }
    case "date-timestamp": {
      if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.trim()))
        throw new Error(
          "Use ISO 8601 with an explicit timezone, e.g. 2026-09-18T10:00:00Z.",
        );
      const t = Date.parse(input);
      if (!Number.isFinite(t)) throw new Error("Invalid ISO date.");
      return String(Math.floor(t / 1000));
    }
    case "sha256": {
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(input),
      );
      return Array.from(new Uint8Array(bytes), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    }
    case "uuid":
      return crypto.randomUUID();
    default:
      throw new Error("Unknown text tool.");
  }
}
export const tools = [
  ["json-format", "Format JSON", "Pretty print JSON with 2-space indentation"],
  ["json-minify", "Minify JSON", "Compact JSON without changing numbers"],
  ["json-validate", "Validate JSON", "Check JSON without changing it"],
  ["json-sort", "Sort JSON keys", "Sort object keys; preserve array order"],
  ["base64-encode", "Base64 encode", "Encode UTF-8 text"],
  ["base64-decode", "Base64 decode", "Decode Base64 to UTF-8"],
  ["url-encode", "URL encode", "Encode a URL component"],
  ["url-decode", "URL decode", "Decode percent-encoded text"],
  ["html-encode", "HTML entity encode", "Escape HTML characters"],
  ["html-decode", "HTML entity decode", "Decode entities into plain text"],
  ["upper", "UPPERCASE", "Convert selection to uppercase"],
  ["lower", "lowercase", "Convert selection to lowercase"],
  ["camel", "camelCase", "Convert words to camel case"],
  ["snake", "snake_case", "Convert words to snake case"],
  ["kebab", "kebab-case", "Convert words to kebab case"],
  ["sort", "Sort lines A–Z", "Sort lines alphabetically"],
  ["sort-desc", "Sort lines Z–A", "Reverse alphabetical order"],
  ["sort-natural", "Natural sort lines", "Sort item2 before item10"],
  ["dedup", "Remove duplicate lines", "Keep the first occurrence"],
  ["trim", "Trim trailing whitespace", "Clean line endings"],
  [
    "remove-empty",
    "Remove empty lines",
    "Remove blank or whitespace-only lines",
  ],
  ["join", "Join lines", "Combine lines with spaces"],
  ["count", "Count text", "Characters, words, and lines"],
  ["jwt", "Decode JWT", "Inspect only; signature is not verified"],
  ["timestamp-seconds", "Unix seconds → date", "Convert seconds to UTC"],
  ["timestamp-ms", "Unix milliseconds → date", "Convert milliseconds to UTC"],
  [
    "date-timestamp",
    "Date → Unix seconds",
    "Convert an ISO date with timezone",
  ],
  ["sha256", "SHA-256", "Calculate the digest of UTF-8 text"],
  ["uuid", "Generate UUID", "Insert a random UUID v4"],
] as const;
export const inspection = new Set(["json-validate", "count", "jwt", "sha256"]);
