import type { JSONContent } from "@tiptap/core";
import type { Attachment } from "./types";
export function serialize(doc: JSONContent): {
  body: string;
  attachments: Attachment[];
} {
  let body = "";
  const attachments: Attachment[] = [];
  let blocks = 0;
  const walk = (node: JSONContent) => {
    if (["paragraph", "heading", "codeBlock"].includes(node.type ?? "")) {
      if (blocks++) body += "\n";
    }
    if (node.type === "text")
      body += (node.text ?? "").replaceAll("\uFFFC", "�");
    else if (node.type === "image") {
      attachments.push({
        offset: body.length,
        id: Number(node.attrs?.imageId),
      });
      body += "\uFFFC";
    } else if (node.type === "hardBreak") body += "\n";
    else node.content?.forEach(walk);
  };
  walk(doc);
  return { body, attachments };
}
export function deserialize(
  body: string,
  attachments: Attachment[],
  urls: Map<number, string>,
): JSONContent {
  const refs = new Map(attachments.map((a) => [a.offset, a.id]));
  let offset = 0;
  const content = body.split("\n").map((line) => {
    const nodes: JSONContent[] = [];
    let text = "";
    const flush = () => {
      if (text) {
        nodes.push({ type: "text", text });
        text = "";
      }
    };
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "\uFFFC") {
        flush();
        const id = refs.get(offset + i);
        if (id !== undefined)
          nodes.push({
            type: "image",
            attrs: {
              imageId: id,
              src: urls.get(id) ?? "",
              alt: "Pasted image",
            },
          });
        else text += "[missing image]";
      } else text += line[i];
    }
    flush();
    offset += line.length + 1;
    return { type: "paragraph", content: nodes };
  });
  return { type: "doc", content };
}

// Persist only semantic attributes: display URLs and clipboard HTML never belong in SQLite.
export function canonical(doc: JSONContent): JSONContent {
  const node: JSONContent = { type: doc.type };
  if (doc.text !== undefined) node.text = doc.text.replaceAll("\uFFFC", "�");
  if (doc.content) node.content = doc.content.map(canonical);
  if (doc.type === "heading") node.attrs = { level: doc.attrs?.level ?? 1 };
  if (["paragraph", "heading"].includes(doc.type ?? "")) {
    for (const key of ["lineHeight", "paragraphSpacing"]) {
      if (doc.attrs?.[key] != null)
        node.attrs = { ...node.attrs, [key]: doc.attrs[key] };
    }
  }
  if (doc.type === "orderedList") node.attrs = { start: doc.attrs?.start ?? 1 };
  if (doc.type === "codeBlock")
    node.attrs = { language: doc.attrs?.language ?? null };
  if (doc.type === "image")
    node.attrs = {
      imageId: doc.attrs?.imageId,
      alt: doc.attrs?.alt ?? "Image",
    };
  if (doc.type === "text" && doc.marks?.length)
    node.marks = doc.marks.map((m) =>
      m.type === "link"
        ? { type: m.type, attrs: { href: m.attrs?.href } }
        : m.type === "textStyle"
          ? {
              type: m.type,
              attrs: Object.fromEntries(
                ["fontFamily", "fontSize"]
                  .filter((k) => m.attrs?.[k] != null)
                  .map((k) => [k, m.attrs![k]]),
              ),
            }
          : { type: m.type },
    );
  return node;
}
export function withImageUrls(
  doc: JSONContent,
  urls: Map<number, string>,
): JSONContent {
  return {
    ...doc,
    ...(doc.type === "image"
      ? {
          attrs: {
            ...doc.attrs,
            src: urls.get(Number(doc.attrs?.imageId)) ?? "",
          },
        }
      : {}),
    ...(doc.content
      ? { content: doc.content.map((n) => withImageUrls(n, urls)) }
      : {}),
  };
}
