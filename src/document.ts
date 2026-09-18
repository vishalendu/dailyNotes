import type { JSONContent } from "@tiptap/core";
import type { Attachment } from "./types";
export function serialize(doc: JSONContent): {
  body: string;
  attachments: Attachment[];
} {
  let body = "";
  const attachments: Attachment[] = [];
  const walk = (node: JSONContent) => {
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
  (doc.content ?? []).forEach((node, i) => {
    if (i) body += "\n";
    walk(node);
  });
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
