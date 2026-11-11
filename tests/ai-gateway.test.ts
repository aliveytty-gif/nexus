import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { describe, it } from "node:test";

type Options = { token: string; model?: string; ollamaUrl?: string; deadlineMs?: number; fetchImpl?: typeof fetch; log?: (code: string) => void };
const { createGateway } = await import(new URL("../infra/ai/gateway.mjs", import.meta.url).href) as { createGateway: (options: Options) => Server };
const token = "test-only-gateway-token-0123456789abcdef";
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const requestBody = (content = "Привет") => ({ model: "gpt-oss:20b", messages: [{ role: "user", content }], maxOutputTokens: 400 });
const event = (content = "Привет", done = false) => JSON.stringify({ model: "gpt-oss:20b", message: { role: "assistant", content }, done }) + "\n";
async function listen(server: Server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}
async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void, options: Partial<Options> = {}) {
  const upstream = createServer(handler);
  const base = await listen(upstream);
  const logs: string[] = [];
  const gateway = createGateway({ token, ollamaUrl: base, log: (code) => logs.push(code), ...options });
  const url = await listen(gateway);
  return { url, logs, close: async () => {
    const stopped = [once(gateway, "close"), once(upstream, "close")];
    gateway.close(); gateway.closeAllConnections(); upstream.close(); upstream.closeAllConnections(); await Promise.all(stopped);
  } };
}
const post = (url: string, body: unknown, signal?: AbortSignal) => fetch(`${url}/v1/chat`, { method: "POST", headers, body: JSON.stringify(body), signal });
const good = (_request: IncomingMessage, response: ServerResponse) => response.end(event("Ответ", true));

describe("self-hosted AI gateway HTTP boundary", () => {
  it("requires a strong token, rejects cloud configuration and authenticates health/chat", async () => {
    assert.throws(() => createGateway({ token: "short" }), /invalid_gateway_token/);
    assert.throws(() => createGateway({ token, model: "gpt-oss:20b-cloud" }), /invalid_local_model/);
    const f = await fixture(good);
    try {
      for (const path of ["/healthz", "/v1/chat"]) {
        const response = await fetch(f.url + path, { headers: { authorization: "Bearer wrong" } });
        assert.equal(response.status, 401); assert.ok(!(await response.text()).includes(token));
      }
      assert.equal((await fetch(f.url + "/other", { headers })).status, 404);
      assert.equal((await fetch(f.url + "/v1/chat", { headers })).status, 405);
    } finally { await f.close(); }
  });

  it("health checks the exact installed model without running inference", async () => {
    const paths: string[] = []; let installed = true;
    const f = await fixture((request, response) => {
      paths.push(request.url ?? ""); response.end(JSON.stringify({ models: [{ name: installed ? "gpt-oss:20b" : "gpt-oss:120b" }] }));
    });
    try {
      let response = await fetch(f.url + "/healthz", { headers });
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ready: true, model: "gpt-oss:20b" });
      installed = false; response = await fetch(f.url + "/healthz", { headers });
      assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ready: false, model: "gpt-oss:20b" });
      assert.deepEqual(paths, ["/api/tags", "/api/tags"]);
    } finally { await f.close(); }
  });

  it("bounds body, roles, context bytes, model and output tokens before inference", async () => {
    let calls = 0;
    const f = await fixture((_request, response) => { calls++; good(_request, response); });
    try {
      const valid = requestBody();
      const invalid = [
        { ...valid, model: "gpt-oss:20b-cloud" }, { ...valid, maxOutputTokens: 1201 },
        { ...valid, messages: [{ role: "assistant", content: "x" }] },
        { ...valid, messages: [{ role: "user", content: "x" }, { role: "system", content: "x" }, { role: "user", content: "x" }] },
        { ...valid, messages: [{ role: "user", content: "x".repeat(4001) }] },
        { ...valid, messages: [{ role: "user", content: "   " }] },
        { ...valid, messages: [{ role: "user", content: "я".repeat(4000) }, { role: "assistant", content: "я".repeat(4000) }, { role: "user", content: "я".repeat(4000) }] },
      ];
      for (const body of invalid) assert.equal((await post(f.url, body)).status, 400);
      const tooLarge = await post(f.url, { ...valid, ignored: "x".repeat(65536) });
      assert.equal(tooLarge.status, 413);
      const malformed = await fetch(f.url + "/v1/chat", { method: "POST", headers, body: "{" });
      assert.equal(malformed.status, 400); assert.equal(calls, 0);
    } finally { await f.close(); }
  });

  it("streams real Russian UTF-8 chunks, strips thinking/tools and forwards only clean context", async () => {
    let payload: Record<string, unknown> = {};
    const f = await fixture(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
      payload = JSON.parse(Buffer.concat(chunks).toString());
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      const bytes = Buffer.from(JSON.stringify({ model: "gpt-oss:20b", message: { role: "assistant", thinking: "SECRET_THINKING", content: "Привет, мир!", tool_calls: [{ secret: "TOOLS" }] }, done: false }) + "\n");
      const split = bytes.indexOf(Buffer.from("П")) + 1;
      response.write(bytes.subarray(0, split));
      setImmediate(() => { response.write(bytes.subarray(split)); response.end(event("", true)); });
    });
    try {
      const response = await post(f.url, { ...requestBody(), messages: [{ role: "system", content: "Ты помощник", tools: "ignored" }, { role: "user", content: "Привет", images: ["ignored"] }] });
      assert.equal(response.status, 200); assert.match(response.headers.get("content-type") ?? "", /ndjson/);
      const text = await response.text();
      assert.deepEqual(text.trim().split("\n").map((line) => JSON.parse(line)), [{ type: "delta", text: "Привет, мир!" }, { type: "done" }]);
      assert.ok(!text.includes("SECRET_THINKING") && !text.includes("TOOLS"));
      assert.deepEqual(payload.messages, [{ role: "system", content: "Ты помощник" }, { role: "user", content: "Привет" }]);
      assert.deepEqual(payload.options, { num_ctx: 16384, num_predict: 400 });
      assert.equal(payload.think, "low"); assert.equal(payload.stream, true);
    } finally { await f.close(); }
  });

  it("sanitizes upstream failures and rejects incomplete or overlong output", async () => {
    let mode = "http";
    const f = await fixture((_request, response) => {
      if (mode === "http") { response.writeHead(500); response.end("RAW_PROVIDER_SECRET"); }
      else if (mode === "incomplete") response.end(event("partial"));
      else if (mode === "raw") response.end(JSON.stringify({ error: "RAW_PROVIDER_SECRET" }) + "\n");
      else response.end(event("x".repeat(16001), true));
    });
    try {
      for (mode of ["http", "incomplete", "raw", "length"]) {
        const response = await post(f.url, requestBody());
        const text = await response.text(); assert.ok(!text.includes("RAW_PROVIDER_SECRET"));
        const last = JSON.parse(text.trim().split("\n").at(-1) ?? "{}"); assert.equal(last.type, "error");
        assert.ok(["unavailable", "invalid_response"].includes(last.code)); assert.ok(!text.includes('"type":"done"'));
      }
      assert.ok(f.logs.every((code) => ["unavailable", "invalid_response"].includes(code)));
    } finally { await f.close(); }
  });

  it("has no generation queue, aborts Ollama on disconnect and accepts the next request", async () => {
    let release: (() => void) | undefined; let calls = 0;
    const firstClosed = new Promise<void>((resolve) => { release = resolve; });
    const f = await fixture((_request, response) => {
      calls++;
      if (calls > 1) { response.end(event("Следующий", true)); return; }
      response.writeHead(200); response.write(event("Начало")); response.once("close", () => release?.());
    });
    const controller = new AbortController();
    try {
      const response = await post(f.url, requestBody(), controller.signal);
      const reader = response.body?.getReader(); assert.ok(reader); await reader.read();
      const busy = await post(f.url, requestBody()); assert.equal(busy.status, 429); assert.equal(busy.headers.get("retry-after"), "5");
      controller.abort(); await firstClosed;
      let next: Response | undefined;
      for (let attempt = 0; attempt < 10; attempt++) {
        next = await post(f.url, requestBody()); if (next.status !== 429) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(next?.status, 200); assert.match(await next!.text(), /Следующий/); assert.equal(calls, 2);
    } finally { controller.abort(); await f.close(); }
  });

  it("deadline aborts a stalled upstream stream and returns a technical timeout", async () => {
    let upstreamClosed: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => { upstreamClosed = resolve; });
    const f = await fixture((_request, response) => {
      response.writeHead(200); response.write(event("Начало")); response.once("close", () => upstreamClosed?.());
    }, { deadlineMs: 80 });
    try {
      const response = await post(f.url, requestBody());
      const text = await response.text(); assert.match(text, /"code":"timeout"/); await closed;
      assert.deepEqual(f.logs, ["timeout"]);
    } finally { await f.close(); }
  });

  it("retains the concurrency slot until an aborted fetch actually settles", async () => {
    let settle: (() => void) | undefined;
    const fetchImpl = ((_url: unknown, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => { settle = () => reject(new Error("aborted")); }, { once: true });
    })) as typeof fetch;
    const f = await fixture(good, { fetchImpl });
    const controller = new AbortController();
    const first = post(f.url, requestBody(), controller.signal).catch(() => undefined);
    try {
      for (let n = 0; n < 20 && !settle; n++) {
        const busy = await post(f.url, requestBody());
        if (busy.status === 429) { controller.abort(); break; }
      }
      for (let n = 0; n < 20 && !settle; n++) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.ok(settle); assert.equal((await post(f.url, requestBody())).status, 429);
      settle(); await first;
    } finally { settle?.(); controller.abort(); await f.close(); }
  });
});
