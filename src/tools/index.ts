import { tools, inspection } from "./transforms";
import type { Command } from "../types";
import type { NoteEditor } from "../editor";
import { ask, showDialog, escape, $, notify } from "../ui";
export function toolCommands(
  editor: NoteEditor,
  revision: () => number,
): Command[] {
  return tools.map(([id, title, description]) => ({
    id,
    title,
    description,
    group: "Text tools",
    aliases: id === "json-format" ? "pretty print beautify" : "",
    run: async () => {
      const initial = revision();
      let selection = editor.selection();
      if (selection.from === selection.to && id !== "uuid") {
        if (
          !inspection.has(id) &&
          !(await ask(
            "Use the entire note?",
            "Select a passage to transform only that text, or apply this tool to the whole note.",
            "Use entire note",
          ))
        )
          return;
        editor.editor.commands.selectAll();
        selection = editor.selection();
      }
      if (selection.image)
        throw new Error(
          "Select text only. Images will not be removed by a text tool.",
        );
      const result = await new Promise<string>((resolve, reject) => {
        const worker = new Worker(new URL("./worker.ts", import.meta.url), {
          type: "module",
        });
        const timer = setTimeout(() => {
          worker.terminate();
          reject(
            new Error("This operation took too long. Try a smaller selection."),
          );
        }, 4000);
        worker.onmessage = (e) => {
          clearTimeout(timer);
          worker.terminate();
          e.data.error
            ? reject(new Error(e.data.error))
            : resolve(e.data.result);
        };
        worker.onerror = (e) => {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(e.message));
        };
        worker.postMessage({ id, input: selection.text });
      });
      if (initial !== revision())
        throw new Error(
          "The note changed while the tool was running. Run it again.",
        );
      if (inspection.has(id)) {
        const d = showDialog(
          title,
          `<pre class="tool-result">${escape(result)}</pre><div class="actions"><button id="copy-result" class="button primary">Copy result</button></div>`,
        );
        $("#copy-result", d).onclick = () => {
          navigator.clipboard
            .writeText(result)
            .then(() => notify("Copied"))
            .catch((e) => notify(String(e), true));
        };
      } else editor.replace(selection.from, selection.to, result);
    },
  }));
}
