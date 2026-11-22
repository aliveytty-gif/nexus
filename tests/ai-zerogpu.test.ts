import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

const adapterUrl = new URL("../src/features/ai/zerogpu.ts", import.meta.url).href;
const validationUrl = new URL("../src/features/ai/validation.ts", import.meta.url).href;

function serverTest(source: string) {
  execFileSync(process.execPath, [
    "--conditions=react-server", "--experimental-strip-types", "--input-type=module", "--eval",
    `import assert from "node:assert/strict";
    const { parseZeroGpuRequestId, stopZeroGpuReply, streamZeroGpuReply, zeroGpuMessages, zeroGpuOperationId } =
      await import(${JSON.stringify(adapterUrl)});
    const { AiError } = await import(${JSON.stringify(validationUrl)});
    const token = "test-only-zerogpu-key";
    const requestId = "0777a0de-8845-4b8b-88a7-cc3feab26771";
    const operationId = zeroGpuOperationId(token, "user-a", requestId);
    const origin = "https://aliveytty-nexus.hf.space";
    const chatUrl = origin + "/gradio_api/call/chat";
    const stopUrl = origin + "/stop/" + operationId;
    const eventId = "51d4da0f7acd4820adf37ef05ebada88";
    const options = { token, operationId, messages: zeroGpuMessages([{ role: "user", content: "Привет" }]),
      maxTokens: 92, signal: new AbortController().signal };
    const event = (type, data, eol = "\\n") => "event: " + type + eol + "data: " + JSON.stringify(data) + eol + eol;
    const sse = (body) => new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
    const collect = async (fetcher, extra = {}) => {
      const events = [];
      for await (const item of streamZeroGpuReply({ ...options, ...extra, fetcher })) events.push(item);
      return events;
    };
    const errorIs = (code, status) => (error) => {
      assert.ok(error instanceof AiError);
      assert.equal(error.code, code);
      if (status) assert.equal(error.status, status);
      assert.ok(!error.message.includes(token));
      assert.ok(!error.message.includes("raw-provider-error"));
      return true;
    };
    ${source}`,
  ], { encoding: "utf8", timeout: 10000 });
}

describe("ZeroGPU request boundaries", () => {
  it("validates canonical UUIDs and derives stable user-scoped operation IDs", () => serverTest(`
    assert.equal(parseZeroGpuRequestId({ requestId }), requestId);
    assert.equal(parseZeroGpuRequestId({ requestId: operationId }), operationId);
    assert.equal(zeroGpuOperationId(token, "user-a", requestId), operationId);
    assert.notEqual(operationId, requestId);
    assert.notEqual(operationId, zeroGpuOperationId(token, "user-b", requestId));
    assert.notEqual(operationId, zeroGpuOperationId(token + "x", "user-a", requestId));
    assert.notEqual(operationId, zeroGpuOperationId(token, "user-a", "0777a0de-8845-4b8b-88a7-cc3feab26770"));
    for (const value of [null, {}, requestId, { requestId: 0 }, { requestId: requestId + "\\n" },
      { requestId: requestId.toUpperCase() }, { requestId: "../../config" }])
      assert.throws(() => parseZeroGpuRequestId(value), errorIs("invalid_request", 400));
  `));

  it("keeps the latest complete turns and whitelists fields under the UTF-8 byte cap", () => serverTest(`
    const history = [
      { role: "user", content: "я".repeat(2000) },
      { role: "assistant", content: "устаревший ответ" },
      { role: "user", content: "новый вопрос", tools: ["secret"] },
      { role: "assistant", content: "прошлый ответ", metadata: "secret" },
      { role: "user", content: "текущий вопрос", opId: "secret" },
    ];
    const messages = zeroGpuMessages(history);
    assert.deepEqual(messages.map(({ role }) => role), ["system", "user", "assistant", "user"]);
    assert.deepEqual(messages.slice(1).map(({ content }) => content), history.slice(2).map(({ content }) => content));
    assert.ok(messages[0].content.startsWith("Ты NEXUS AI"));
    assert.ok(messages.every((message) => Object.keys(message).join(",") === "role,content"));
    assert.ok(Buffer.byteLength(JSON.stringify(messages)) <= 4200);
    assert.throws(() => zeroGpuMessages([{ role: "user", content: "я".repeat(2200) }]), errorIs("invalid_context", 400));
    let calls = 0;
    await assert.rejects(collect(async () => { calls++; }, { maxTokens: 129 }), errorIs("not_configured"));
    assert.equal(calls, 0);
  `));
});

describe("ZeroGPU Gradio transport", () => {
  it("authenticates both calls and computes deltas over chunked SSE with UTF-8 and heartbeats", () => serverTest(`
    const encoded = new TextEncoder().encode(
      ": ready\\r\\n\\r\\n" + event("heartbeat", {}, "\\r\\n") +
      "event: generating\\r\\ndata: [\\"При\\",\\r\\ndata: \\"streaming\\"]\\r\\n\\r\\n" +
      event("generating", ["Привет 😺", "streaming"], "\\r\\n") +
      event("generating", ["Привет 😺!", "done"]) +
      event("complete", ["Привет 😺!", "done"]));
    const calls = [];
    const events = await collect(async (url, init) => {
      calls.push(url);
      assert.equal(init.headers.Authorization, "Bearer " + token);
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      assert.equal(init.signal, options.signal);
      if (url === chatUrl) {
        assert.equal(init.method, "POST");
        assert.equal(init.headers["Content-Type"], "application/json");
        const body = JSON.parse(init.body);
        assert.deepEqual(body, { data: [operationId, JSON.stringify(options.messages), 92] });
        assert.ok(!init.body.includes(requestId));
        assert.ok(!init.body.includes(token));
        return Response.json({ event_id: eventId });
      }
      assert.equal(url, chatUrl + "/" + eventId);
      assert.equal(init.method, "GET");
      return sse(new ReadableStream({ start(controller) {
        for (let i = 0; i < encoded.length; i++) controller.enqueue(encoded.slice(i, i + 1));
        controller.close();
      } }));
    });
    assert.deepEqual(calls, [chatUrl, chatUrl + "/" + eventId]);
    assert.deepEqual(events, [{ type: "delta", text: "При" }, { type: "delta", text: "вет 😺" },
      { type: "delta", text: "!" }, { type: "done" }]);
  `));

  it("requires a complete stopped result before confirming cancellation", () => serverTest(`
    const calls = [];
    const events = await collect(async (url) => {
      calls.push(url);
      if (url === chatUrl) return Response.json({ event_id: eventId });
      return sse(event("generating", ["часть", "streaming"]) + event("generating", ["часть", "stopped"]) +
        event("complete", ["часть", "stopped"]));
    });
    assert.deepEqual(events, [{ type: "delta", text: "часть" }, { type: "stopped", confirmed: true }]);
    assert.deepEqual(calls, [chatUrl, chatUrl + "/" + eventId]);
  `));

  it("cleans up early EOF, malformed streams and prefix rewrites before closing the reader", () => serverTest(`
    for (const [body, code] of [
      [event("generating", ["часть", "done"]), "provider_unavailable"],
      [event("generating", ["часть", "stopped"]), "provider_unavailable"],
      [event("complete", ["", "done"]), "provider_invalid"],
      [event("complete", ["часть", "streaming"]), "provider_invalid"],
      [event("generating", ["часть", "streaming"]) + event("complete", ["другая", "done"]), "provider_invalid"],
      [event("generating", ["x".repeat(16385), "streaming"]), "provider_invalid"],
      ["event: generating\\ndata: [invalid]\\n\\n", "provider_invalid"],
      ["event: heartbeat\\ndata: " + "x".repeat(65536), "provider_invalid"],
    ]) {
      const stopSignals = [];
      await assert.rejects(collect(async (url, init) => {
        if (url === chatUrl) return Response.json({ event_id: eventId });
        if (url !== stopUrl) return sse(body);
        stopSignals.push(init.signal);
        return Response.json({ stopped: true });
      }), errorIs(code, 503));
      assert.equal(stopSignals.length, 1);
      assert.notEqual(stopSignals[0], options.signal);
    }
    let readerCancelled = false;
    let readerCancelledOnStop;
    const generation = streamZeroGpuReply({ ...options, fetcher: async (url) => {
      if (url === chatUrl) return Response.json({ event_id: eventId });
      if (url === stopUrl) {
        readerCancelledOnStop = readerCancelled;
        return Response.json({ stopped: true });
      }
      return sse(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(event("generating", ["часть", "streaming"]))); },
        cancel() { readerCancelled = true; },
      }));
    } });
    assert.deepEqual(await generation.next(), { done: false, value: { type: "delta", text: "часть" } });
    await generation.return();
    assert.equal(readerCancelledOnStop, false);
    assert.equal(readerCancelled, true);
  `));

  it("bounds total SSE bytes across otherwise valid heartbeats", () => serverTest(`
    let stopped = 0;
    const beat = new TextEncoder().encode(event("heartbeat", "x".repeat(32 * 1024)));
    await assert.rejects(collect(async (url) => {
      if (url === chatUrl) return Response.json({ event_id: eventId });
      if (url === stopUrl) { stopped++; return Response.json({ stopped: true }); }
      return sse(new ReadableStream({ start(controller) {
        for (let i = 0; i < 34; i++) controller.enqueue(beat);
        controller.close();
      } }));
    }), errorIs("provider_invalid", 503));
    assert.equal(stopped, 1);
  `));

  it("maps provider failures and invalid event IDs without exposing raw responses", () => serverTest(`
    const raw = "raw-provider-error " + token;
    for (const [stage, response, code, status] of [
      ["post", new Response(raw, { status: 429 }), "provider_limit", 429],
      ["post", new Response(raw, { status: 401 }), "provider_auth", 503],
      ["post", new Response(raw, { status: 504 }), "provider_timeout", 504],
      ["post", Response.json({ event_id: "../../settings" }), "provider_invalid", 503],
      ["post", Response.json({ event_id: eventId + "\\n" }), "provider_invalid", 503],
      ["post", Response.json({ event_id: "x".repeat(2048) }), "provider_invalid", 503],
      ["get", new Response("<html>" + raw), "provider_invalid", 503],
      ["get", sse(event("error", { error: "GPU quota exceeded " + raw })), "provider_limit", 429],
      ["get", sse(event("error", { error: "NEXUS_CONTEXT_LIMIT " + raw })), "invalid_context", 400],
      ["get", sse(event("error", { error: "NEXUS_INVALID_REQUEST " + raw })), "invalid_request", 400],
      ["get", sse(event("error", { error: raw })), "provider_unavailable", 503],
    ]) {
      const calls = [];
      await assert.rejects(collect(async (url) => {
        calls.push(url);
        if (url === chatUrl) return stage === "post" ? response : Response.json({ event_id: eventId });
        if (url === chatUrl + "/" + eventId) return response;
        assert.equal(url, stopUrl);
        return Response.json({ stopped: false });
      }), errorIs(code, status));
      assert.deepEqual(calls, stage === "post" ? [chatUrl, stopUrl] : [chatUrl, chatUrl + "/" + eventId, stopUrl]);
    }
  `));

  it("uses a fresh Stop signal when cancellation races the submission POST", () => serverTest(`
    const abort = new AbortController();
    const calls = [];
    let stopOptions;
    const fetcher = async (url, init) => {
      calls.push(url);
      if (url === chatUrl) {
        abort.abort(new DOMException("raw-provider-error", "AbortError"));
        init.signal.throwIfAborted();
        throw new Error("unexpected continuation");
      }
      stopOptions = init;
      return Response.json({ stopped: true });
    };
    await assert.rejects(collect(fetcher, { signal: abort.signal }), errorIs("provider_timeout", 504));
    assert.deepEqual(calls, [chatUrl, stopUrl]);
    assert.equal(stopOptions.method, "POST");
    assert.equal(stopOptions.headers.Authorization, "Bearer " + token);
    assert.equal(stopOptions.cache, "no-store");
    assert.equal(stopOptions.redirect, "error");
    assert.notEqual(stopOptions.signal, abort.signal);
    assert.equal(stopOptions.signal.aborted, false);
    calls.length = 0;
    await assert.rejects(collect(fetcher, { signal: abort.signal }), errorIs("provider_timeout", 504));
    assert.deepEqual(calls, []);
  `));

  it("requests Stop independently after abort interrupts an open event stream", () => serverTest(`
    const abort = new AbortController();
    const calls = [];
    const generation = streamZeroGpuReply({ ...options, signal: abort.signal, fetcher: async (url, init) => {
      calls.push({ url, signal: init.signal });
      if (url === chatUrl) return Response.json({ event_id: eventId });
      if (url === stopUrl) return Response.json({ stopped: true });
      return sse(new ReadableStream({ start(controller) {
        init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
        controller.enqueue(new TextEncoder().encode(event("generating", ["часть", "streaming"])));
      } }));
    } });
    assert.deepEqual(await generation.next(), { done: false, value: { type: "delta", text: "часть" } });
    const pending = generation.next();
    abort.abort();
    await assert.rejects(pending, errorIs("provider_timeout", 504));
    assert.deepEqual(calls.map(({ url }) => url), [chatUrl, chatUrl + "/" + eventId, stopUrl]);
    assert.equal(calls[1].signal, abort.signal);
    assert.notEqual(calls[2].signal, abort.signal);
    assert.equal(calls[2].signal.aborted, false);
  `));

  it("confirms Stop only on an explicit bounded true response", () => serverTest(`
    for (const [response, expected] of [
      [Response.json({ stopped: true }), true],
      [Response.json({ stopped: false }), false],
      [Response.json({ stopped: "true" }), false],
      [Response.json({ stopped: true, details: "x".repeat(1024) }), false],
      [new Response("not JSON"), false],
      [new Response(null, { status: 302, headers: { Location: "https://other.invalid/" } }), false],
    ]) {
      assert.equal(await stopZeroGpuReply(token, operationId, async (url, init) => {
        assert.equal(url, stopUrl);
        assert.equal(init.method, "POST");
        assert.equal(init.headers.Authorization, "Bearer " + token);
        assert.equal(init.redirect, "error");
        assert.ok(init.signal instanceof AbortSignal);
        return response;
      }), expected);
    }
    let calls = 0;
    assert.equal(await stopZeroGpuReply(token, "../config", async () => { calls++; }), false);
    assert.equal(calls, 0);
  `));
});
