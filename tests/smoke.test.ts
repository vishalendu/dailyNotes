import test from "node:test";
import assert from "node:assert/strict";
import { transform } from "../src/tools/transforms.ts";
import { serialize, deserialize } from "../src/document.ts";

test("text and inline images round-trip with Unicode offsets", () => {
  const body = "Today 👋\nScreenshot: \uFFFC\n\nDone";
  const attachments = [{ offset: body.indexOf("\uFFFC"), id: 42 }];
  assert.deepEqual(
    serialize(
      deserialize(
        body,
        attachments,
        new Map([[42, "data:image/png;base64,test"]]),
      ),
    ),
    { body, attachments },
  );
});
test("JSON formatting/minifying preserves large numbers and validates input", async () => {
  const input = '{"id":9007199254740993123,"items":[2,1],"name":"café"}';
  const formatted = await transform("json-format", input);
  assert.ok(formatted.includes("9007199254740993123"));
  assert.equal(await transform("json-minify", formatted), input);
  assert.equal(
    await transform("json-sort", '{"z":2,"a":[3,1]}'),
    '{\n  "a": [\n    3,\n    1\n  ],\n  "z": 2\n}',
  );
  await assert.rejects(() => transform("json-format", '{"broken":}'));
  await assert.rejects(() => transform("json-sort", '{"a":1,"a":2}'));
});
test("encoding and developer utilities work on real text", async () => {
  const input = "Hello 👋 / café";
  assert.equal(
    await transform("base64-decode", await transform("base64-encode", input)),
    input,
  );
  assert.equal(
    await transform("url-decode", await transform("url-encode", input)),
    input,
  );
  assert.equal(
    await transform("html-decode", "&lt;script&gt;&amp;"),
    "<script>&",
  );
  assert.equal(await transform("dedup", "one\ntwo\none"), "one\ntwo");
  assert.equal(
    await transform("sort-natural", "item10\nitem2"),
    "item2\nitem10",
  );
  assert.equal(
    await transform("timestamp-seconds", "0"),
    "1970-01-01T00:00:00.000Z",
  );
  assert.equal(
    await transform("sha256", "abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.match(await transform("uuid", ""), /^[0-9a-f-]{36}$/);
  await assert.rejects(() => transform("base64-decode", "%%bad"));
});

test("nested rich documents share a stable text/image projection", async () => {
  const { readFileSync } = await import("node:fs");
  const { canonical, withImageUrls } = await import("../src/document.ts");
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/rich-document.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(serialize(fixture.content), {
    body: fixture.body,
    attachments: fixture.attachments,
  });
  assert.deepEqual(
    canonical(
      withImageUrls(
        fixture.content,
        new Map([[1, "data:image/png;base64,example"]]),
      ),
    ),
    fixture.content,
  );
});
