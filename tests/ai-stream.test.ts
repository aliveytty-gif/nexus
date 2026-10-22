import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readNdjson } from "../src/features/ai/stream.ts";

const encode = (text: string) => new TextEncoder().encode(text);
const collect = async (stream: ReadableStream<Uint8Array>) => Array.fromAsync(readNdjson(stream));

describe("AI NDJSON transport", () => {
  it("preserves UTF-8 split between chunks and accepts only bounded typed events", async () => {
    const bytes = encode('{"type":"meta","userRemaining":4,"globalRemaining":39}\n{"type":"delta","text":"ёж 😀"}\n{"type":"done"}\n');
    const result = await collect(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } }));
    assert.deepEqual(result, [{ type: "meta", userRemaining: 4, globalRemaining: 39 }, { type: "delta", text: "ёж 😀" }, { type: "done" }]);
  });

  it("rejects malformed, invalid UTF-8, oversized, and truncated responses", async () => {
    for (const text of ["not json\n", '{"type":"delta","text":3}\n', '{"type":"meta","userRemaining":-1,"globalRemaining":2}\n',
      '{"type":"delta","text":"partial"}\n', JSON.stringify({ type: "delta", text: "x".repeat(16001) }) + "\n",
      " ".repeat(131073), '{"type":"unknown"}\n'])
      await assert.rejects(collect(new Response(text).body!));
    await assert.rejects(collect(new Response(Uint8Array.of(0xff)).body!));
  });

  it("cancels its source when the reader stops early", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encode('{"type":"delta","text":"first"}\n'));
    }, cancel() { cancelled = true; } });
    for await (const event of readNdjson(stream)) { assert.equal(event.type, "delta"); break; }
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  });

  it("accepts many small events coalesced into one large network chunk", async () => {
    const text = '{"type":"delta","text":"x"}\n'.repeat(1500) + '{"type":"done"}\n';
    assert.ok(text.length > 32768);
    const events = await collect(new Response(text).body!);
    assert.equal(events.length, 1501);
    assert.equal(events.at(-1)?.type, "done");
  });
});
