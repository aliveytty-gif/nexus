import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import ts from "typescript";
import { AiError, boundedJson, validateChat } from "../src/features/ai/validation.ts";

const clientId = "7f5bd1e3-0956-48bd-9201-c4f767c6a075";
const aliceOp = "36679986-212a-501c-984c-b0ca2d83ac34";
const bobOp = "49216cdd-7998-5cef-9833-e559906bc3a5";
const question = { consent: true, messages: [{ role: "user", content: "Тест" }], requestId: clientId };
const makeRequest = (method: string, body: object, origin = "https://nexus.example") => new Request("https://nexus.example/api/ai", {
  method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});

async function harness() {
  const state = { user: "alice", allowed: true, reserved: 0, finished: 0, started: 0, aborted: false, operations: [] as string[] };
  let resolve!: () => void;
  const release = new Promise<void>((done) => { resolve = done; });
  const mocks = {
    AiError, boundedJson, validateChat, timingSafeEqual,
    after: () => undefined,
    getCurrentUser: async () => state.user ? { id: state.user } : null,
    getAiConfig: () => ({ enabled: true, ready: true, provider: "zerogpu", zeroGpuToken: "secret", maxOutputTokens: 96, userLimit: 3, globalLimit: 8 }),
    availableModels: async () => ["Qwen/Qwen3.5-2B"],
    generateReply: () => assert.fail("ZeroGPU must not fall back"),
    parseZeroGpuRequestId: (body: { requestId?: string }) => {
      if (body.requestId !== clientId) throw new AiError("invalid_request", "Invalid request ID", 400);
      return body.requestId;
    },
    zeroGpuOperationId: (_: string, user: string) => user === "alice" ? aliceOp : bobOp,
    zeroGpuMessages: (messages: unknown) => messages,
    stopZeroGpuReply: async (_: string, id: string) => { state.operations.push(id); return id === aliceOp; },
    streamZeroGpuReply: async function* ({ signal, operationId }: { signal: AbortSignal; operationId: string }) {
      state.started++;
      state.operations.push(operationId);
      signal.addEventListener("abort", () => { state.aborted = true; resolve(); }, { once: true });
      await release;
      if (!signal.aborted) {
        yield { type: "delta", text: "Ответ" };
        yield { type: "done" };
      }
    },
    createClient: async () => ({ rpc(name: string) {
      const finishing = name === "finish_ai_request";
      if (finishing) state.finished++;
      else state.reserved++;
      return { abortSignal: async () => ({ error: null, data: finishing ? null : {
        allowed: state.allowed, code: state.allowed ? undefined : "busy", request_id: "quota-lease",
        user_remaining: 2, global_remaining: 7,
      } }) };
    } }),
  };
  const registry = globalThis as unknown as Record<string, unknown>;
  const key = `__nexusZeroGpuRoute${crypto.randomUUID()}`;
  registry[key] = mocks;
  const source = (await readFile(new URL("../src/app/api/ai/route.ts", import.meta.url), "utf8"))
    .replace(/^import .* from "[^"]+";\n/gm, "");
  const { outputText } = ts.transpileModule(`const {${Object.keys(mocks).join(",")}} = globalThis[${JSON.stringify(key)}];\n${source}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  try {
    const route: typeof import("../src/app/api/ai/route") = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
    return { route, state, resolve };
  } finally {
    delete registry[key];
  }
}

it("validates ZeroGPU origin, auth and operation before the persistent quota or model", async () => {
  const { route, state } = await harness();
  assert.equal((await route.POST(makeRequest("POST", question, "https://other.example"))).status, 403);
  assert.equal((await route.DELETE(makeRequest("DELETE", question, "https://other.example"))).status, 403);
  state.user = "";
  assert.equal((await route.POST(makeRequest("POST", question))).status, 401);
  assert.equal((await route.DELETE(makeRequest("DELETE", question))).status, 401);
  state.user = "alice";
  assert.equal((await route.POST(makeRequest("POST", { ...question, requestId: "incorrect" }))).status, 400);
  assert.equal(state.reserved, 0);
  assert.equal(state.started, 0);
  assert.deepEqual(state.operations, []);
});

it("denied quota skips ZeroGPU; a granted lease is held to the final stream event", async () => {
  const { route, state, resolve } = await harness();
  state.allowed = false;
  assert.equal((await route.POST(makeRequest("POST", question))).status, 429);
  assert.equal(state.started, 0);
  state.allowed = true;
  const response = await route.POST(makeRequest("POST", question));
  assert.match(response.headers.get("content-type") ?? "", /application\/x-ndjson/);
  assert.equal(state.reserved, 2);
  assert.equal(state.finished, 0);
  resolve();
  assert.deepEqual((await response.text()).trim().split("\n").map((line) => JSON.parse(line)), [
    { type: "meta", userRemaining: 2, globalRemaining: 7, stopProof: aliceOp }, { type: "delta", text: "Ответ" }, { type: "done" },
  ]);
  assert.equal(state.finished, 1);
});

it("uses the authenticated user for Stop and releases a disconnected stream once", async () => {
  const { route, state } = await harness();
  const response = await route.POST(makeRequest("POST", question));
  state.user = "bob";
  const stop = { requestId: clientId, stopProof: aliceOp };
  assert.equal((await route.DELETE(makeRequest("DELETE", stop))).status, 404);
  state.user = "alice";
  assert.equal((await route.DELETE(makeRequest("DELETE", { requestId: clientId }))).status, 404);
  assert.equal((await route.DELETE(makeRequest("DELETE", stop))).status, 200);
  assert.deepEqual(state.operations, [aliceOp, aliceOp]);
  await response.body?.cancel();
  assert.ok(state.aborted);
  assert.equal(state.finished, 1);
});
