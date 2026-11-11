import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import ts from "typescript";
import { AiError, boundedJson, validateChat } from "../src/features/ai/validation.ts";

type Gate = { promise: Promise<void>; release: () => void };
function gate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function harness() {
  const state = { authenticated: true, allowed: true, finished: 0, reserved: 0, calls: 0, aborted: false, ready: true, streaming: true, fail: false };
  const pending = gate();
  const config = { enabled: true, ready: true, provider: "ollama", streaming: true, model: "gpt-oss:20b", userLimit: 5, globalLimit: 40,
    gatewayUrl: "https://private-ai.example", gatewayToken: "not-for-browsers" };
  const mocks = {
    AiError, boundedJson, validateChat,
    getCurrentUser: async () => state.authenticated ? { id: "current-user" } : null,
    getAiConfig: () => ({ ...config, streaming: state.streaming }),
    providerMessages: () => [], availableModels: async () => [config.model], probeAi: async () => state.ready,
    generateReply: async () => { state.calls++; await pending.promise; return { reply: "JSON answer", model: config.model }; },
    streamReply: async function* (_config: unknown, _model: unknown, _messages: unknown, signal: AbortSignal) {
      state.calls++;
      signal.addEventListener("abort", () => { state.aborted = true; pending.release(); }, { once: true });
      await pending.promise;
      if (state.aborted) throw new Error("aborted");
      if (state.fail) throw new Error("raw provider secret and prompt");
      yield "first ";
      yield "answer";
    },
    createClient: async () => ({ rpc(name: string) {
      if (name === "finish_ai_request") state.finished++;
      else state.reserved++;
      return { abortSignal: async () => ({ error: null, data: name === "finish_ai_request" ? null : {
        allowed: state.allowed, request_id: "held-request", user_remaining: 4, global_remaining: 39, code: state.allowed ? undefined : "busy",
      } }) };
    } }),
  };
  const key = `__nexusAiRoute${Math.random().toString(36).slice(2)}`;
  (globalThis as unknown as Record<string, unknown>)[key] = mocks;
  const source = (await readFile(new URL("../src/app/api/ai/route.ts", import.meta.url), "utf8"))
    .replace(/^import .* from "[^"]+";\n/gm, "");
  const { outputText } = ts.transpileModule(`const {${Object.keys(mocks).join(",")}} = globalThis[${JSON.stringify(key)}];\n${source}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const route = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
  return { state, mocks, config, pending, route, dispose: () => { delete (globalThis as unknown as Record<string, unknown>)[key]; } };
}
const request = (options: RequestInit = {}) => new Request("https://nexus.example/api/ai", {
  method: "POST", headers: { origin: "https://nexus.example", "content-type": "application/json" },
  body: JSON.stringify({ consent: true, messages: [{ role: "user", content: "Question" }] }), ...options,
});

describe("AI route authentication and streaming leases", () => {
  it("blocks foreign origins and anonymous requests before quota or provider access", async () => {
    const h = await harness();
    try {
      const foreign = await h.route.POST(request({ headers: { origin: "https://foreign.example" } }));
      assert.equal(foreign.status, 403);
      h.state.authenticated = false;
      assert.equal((await h.route.POST(request())).status, 401);
      assert.equal((await h.route.GET(new Request("https://nexus.example/api/ai"))).status, 401);
      assert.equal(h.state.reserved, 0); assert.equal(h.state.calls, 0); assert.equal(h.state.finished, 0);
    } finally { h.dispose(); }
  });

  it("returns only safe authenticated health and never URL or bearer credentials", async () => {
    const h = await harness();
    try {
      for (const ready of [true, false]) {
        h.state.ready = ready;
        const response = await h.route.GET(new Request("https://nexus.example/api/ai"));
        const body = await response.json();
        assert.deepEqual(body, { status: ready ? "ready" : "unavailable", provider: "ollama", model: "gpt-oss:20b" });
        assert.ok(!JSON.stringify(body).includes(h.config.gatewayUrl));
        assert.ok(!JSON.stringify(body).includes(h.config.gatewayToken));
        assert.ok(response.headers.get("cache-control").includes("no-store"));
      }
    } finally { h.dispose(); }
  });

  it("holds the reservation after returning headers, then releases once after the full stream", async () => {
    const h = await harness();
    try {
      const response = await h.route.POST(request());
      assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
      assert.equal(h.state.reserved, 1); assert.equal(h.state.finished, 0);
      const body = response.text();
      h.pending.release();
      const events = (await body).trim().split("\n").map((line: string) => JSON.parse(line));
      assert.deepEqual(events, [{ type: "meta", userRemaining: 4, globalRemaining: 39 }, { type: "delta", text: "first " }, { type: "delta", text: "answer" }, { type: "done" }]);
      assert.equal(h.state.finished, 1);
    } finally { h.dispose(); }
  });

  it("cancels upstream generation and releases once when the response reader cancels", async () => {
    const h = await harness();
    try {
      const response = await h.route.POST(request());
      await response.body.cancel();
      assert.equal(h.state.aborted, true);
      assert.equal(h.state.finished, 1);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(h.state.finished, 1);
    } finally { h.dispose(); }
  });

  it("sanitizes provider exceptions in the stream and still releases its reservation", async () => {
    const h = await harness();
    try {
      h.state.fail = true;
      h.pending.release();
      const response = await h.route.POST(request());
      const body = await response.text();
      assert.ok(body.includes('"type":"error"')); assert.ok(!body.includes("raw provider"));
      assert.ok(!body.includes('"type":"done"')); assert.equal(h.state.finished, 1);
    } finally { h.dispose(); }
  });

  it("keeps JSON compatibility without releasing a request while generation is pending", async () => {
    const h = await harness();
    try {
      h.state.streaming = false;
      const response = h.route.POST(request());
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(h.state.finished, 0);
      h.pending.release();
      assert.equal((await (await response).json()).reply, "JSON answer");
      assert.equal(h.state.finished, 1);
    } finally { h.dispose(); }
  });

  it("does not call the model or finish an ungranted reservation", async () => {
    const h = await harness();
    try {
      h.state.allowed = false;
      const response = await h.route.POST(request());
      assert.equal(response.status, 429); assert.equal((await response.json()).code, "busy");
      assert.equal(h.state.calls, 0); assert.equal(h.state.finished, 0);
    } finally { h.dispose(); }
  });
});
