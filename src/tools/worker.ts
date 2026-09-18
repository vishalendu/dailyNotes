import { transform } from "./transforms";
self.onmessage = async (event: MessageEvent<{ id: string; input: string }>) => {
  try {
    self.postMessage({
      result: await transform(event.data.id, event.data.input),
    });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
