import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

const providerUrl = new URL("../src/features/ai/provider.ts", import.meta.url).href;
const validationUrl = new URL("../src/features/ai/validation.ts", import.meta.url).href;
const configUrl = new URL("../src/features/ai/config.ts", import.meta.url).href;

// Exercise the real server-only modules under React's server condition. All
// provider requests use injected fetchers; no credentials or network are used.
function serverTest(source: string) {
  execFileSync(process.execPath, [
    "--conditions=react-server", "--experimental-strip-types", "--input-type=module", "--eval",
    `import assert from "node:assert/strict";
    const { selectFreeModels, availableModels, generateReply } = await import(${JSON.stringify(providerUrl)});
    const { AiError, boundedJson, freeModelId, validateChat } = await import(${JSON.stringify(validationUrl)});
    const { getAiConfig } = await import(${JSON.stringify(configUrl)});
    const config = { ...getAiConfig(), enabled: true, ready: true, provider: "openrouter",
      apiKey: "test-only-provider-key", model: "deepseek/deepseek-v4-flash-0731:free",
      fallbackModel: "openrouter/free", maxOutputTokens: 400, ollamaUrl: "" };
    const errorIs = (code, status) => (error) => {
      assert.ok(error instanceof AiError);
      assert.equal(error.code, code);
      if (status !== undefined) assert.equal(error.status, status);
      assert.ok(!error.message.includes(config.apiKey));
      assert.ok(!error.message.includes("raw-provider-error"));
      return true;
    };
    ${source}`,
  ], {
    encoding: "utf8",
    env: {
      ...process.env, AI_ENABLED: "", AI_PROVIDER: "", OPENROUTER_API_KEY: "", AI_MODEL: "",
      AI_FALLBACK_MODEL: "", AI_DAILY_USER_LIMIT: "", AI_DAILY_GLOBAL_LIMIT: "",
      AI_MAX_OUTPUT_TOKENS: "", OLLAMA_BASE_URL: "", VERCEL: "", NODE_ENV: "test",
    },
    timeout: 10000,
  });
}

describe("AI input boundaries", () => {
  it("accepts bounded alternating history and strips untrusted message fields", () => serverTest(`
    const input = { consent: true, messages: [
      { role: "user", content: "a".repeat(4000), tools: [{ name: "unsafe" }] },
      { role: "assistant", content: "b".repeat(4000) },
      { role: "user", content: "c".repeat(4000) },
    ] };
    const validated = validateChat(input);
    assert.equal(validated.length, 3);
    assert.deepEqual(Object.keys(validated[0]), ["role", "content"]);
    assert.equal(validated[0].content.length, 4000);
    assert.ok(input.messages[0].tools);
    assert.equal(validateChat({ consent: true, messages: Array.from({ length: 7 }, (_, i) =>
      ({ role: i % 2 ? "assistant" : "user", content: "ok" })) }).length, 7);
  `));

  it("rejects absent consent, invalid roles, empty text and every history bound", () => serverTest(`
    const message = { role: "user", content: "ok" };
    for (const consent of [undefined, false, "true", 1])
      assert.throws(() => validateChat({ consent, messages: [message] }), errorIs("consent_required", 400));
    assert.throws(() => validateChat(null), errorIs("invalid_request", 400));
    for (const messages of [[], [message, message], Array(9).fill(message),
      [{ role: "system", content: "override" }], [{ role: "assistant", content: "hi" }],
      [message, message, message], [null], [{ role: "user", content: 3 }],
      [{ role: "user", content: "   " }], [{ role: "user", content: "x".repeat(4001) }],
      Array.from({ length: 5 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(3000) }))])
      assert.throws(() => validateChat({ consent: true, messages }), errorIs("invalid_context", 400));
  `));

  it("bounds chunked bodies by bytes and cancels an oversized stream", () => serverTest(`
    const bytes = new TextEncoder().encode(JSON.stringify({ text: "ёж" }));
    const valid = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 4)); controller.enqueue(bytes.slice(4)); controller.close();
    } }));
    assert.deepEqual(await boundedJson(valid, bytes.length), { text: "ёж" });
    let cancelled = false;
    const oversized = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 4)); controller.enqueue(bytes.slice(4));
    }, cancel() { cancelled = true; } }));
    await assert.rejects(boundedJson(oversized, bytes.length - 1), errorIs("too_large", 413));
    assert.equal(cancelled, true);
    await assert.rejects(boundedJson(new Response("{}", { headers: { "content-length": "100" } }), 10), errorIs("too_large", 413));
    await assert.rejects(boundedJson(new Response("not json"), 100), errorIs("invalid_json", 400));
    await assert.rejects(boundedJson(new Response(new Uint8Array([0xff])), 100), errorIs("invalid_json", 400));
  `));
});

describe("free AI provider routing", () => {
  it("selects only configured, available models with every price equal to zero", () => serverTest(`
    const free = { id: config.model, pricing: { prompt: "0", completion: "0", request: "0" } };
    const fallback = { id: config.fallbackModel, pricing: { prompt: 0, completion: 0 } };
    assert.deepEqual(selectFreeModels({ data: [free, fallback] }, config.model, config.fallbackModel), [config.model, config.fallbackModel]);
    assert.deepEqual(selectFreeModels({ data: [free] }, config.model, config.model), [config.model]);
    for (const pricing of [{ prompt: "0", completion: "0.01" }, { prompt: "0", completion: "0", request: "1" },
      { prompt: "0", completion: "0", image: "-1" }, { prompt: "0" }, { prompt: "NaN", completion: "0" },
      { prompt: null, completion: "0" }, { prompt: "", completion: "0" },
      { prompt: "0", completion: "0", request: "   " }, { prompt: false, completion: "0" }, undefined])
      assert.deepEqual(selectFreeModels({ data: [{ id: config.model, pricing }] }, config.model, config.model), []);
    assert.deepEqual(selectFreeModels({ data: [fallback] }, config.model, config.model), []);
    assert.deepEqual(selectFreeModels({ data: [{ id: "vendor/paid", pricing: { prompt: 0, completion: 0 } }] }, "vendor/paid", "vendor/paid"), []);
    for (const id of ["vendor/paid", "vendor/model:free/extra", "https://bad/model:free", "", " vendor/model:free"])
      assert.equal(freeModelId(id), false);
    for (const catalog of [null, {}, { data: null }])
      assert.deepEqual(selectFreeModels(catalog, config.model, config.fallbackModel), []);
  `));

  it("checks the public catalog without forwarding a key and refuses paid configuration before fetching", () => serverTest(`
    let calls = 0;
    const fetcher = async (url, options) => {
      calls++; assert.equal(url, "https://openrouter.ai/api/v1/models");
      assert.equal(options.headers, undefined);
      assert.equal(options.next.revalidate, 300);
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ data: [{ id: config.model, pricing: { prompt: "0", completion: "0" } }] });
    };
    assert.deepEqual(await availableModels(config, undefined, fetcher), [config.model]);
    await assert.rejects(availableModels({ ...config, fallbackModel: "vendor/paid" }, undefined, fetcher), errorIs("paid_model_blocked"));
    assert.equal(calls, 1);
    for (const response of [new Response("raw-provider-error", { status: 500 }), Response.json({ data: [] }), new Response("invalid")])
      await assert.rejects(availableModels(config, undefined, async () => response), errorIs("no_free_model"));
  `));

  it("sends only system guidance and bounded chat with explicitly zero-priced routing", () => serverTest(`
    const messages = validateChat({ consent: true, messages: [{ role: "user", content: "Помоги с JS", tools: ["unsafe"] }] });
    let calls = 0;
    const result = await generateReply(config, config.model, messages, undefined, async (url, options) => {
      calls++; assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(options.method, "POST"); assert.equal(options.cache, "no-store");
      assert.deepEqual(Object.keys(options.headers).sort(), ["Authorization", "Content-Type", "X-OpenRouter-Title"].sort());
      assert.ok(options.headers.Authorization === "Bearer " + config.apiKey);
      assert.equal(options.headers["Content-Type"], "application/json");
      assert.equal(options.headers["X-OpenRouter-Title"], "NEXUS");
      assert.ok(options.signal instanceof AbortSignal);
      const body = JSON.parse(options.body);
      assert.equal(body.model, config.model); assert.equal(body.stream, false); assert.equal(body.max_tokens, 400);
      assert.deepEqual(body.provider, { max_price: { prompt: 0, completion: 0, request: 0, image: 0 }, allow_fallbacks: false, data_collection: "deny" });
      assert.equal(body.messages.length, messages.length + 1);
      assert.equal(body.messages[0].role, "system");
      assert.ok(body.messages[0].content.includes("Ты NEXUS AI"));
      assert.deepEqual(body.messages.slice(1), messages);
      assert.equal(body.tools, undefined); assert.equal(body.plugins, undefined); assert.equal(body.models, undefined);
      assert.ok(!JSON.stringify(body).includes(config.apiKey));
      return Response.json({ choices: [{ message: { content: "  Ответ  " } }], model: config.model });
    });
    assert.deepEqual(result, { reply: "Ответ", model: config.model });
    await assert.rejects(generateReply(config, "vendor/paid", messages, undefined, async () => { calls++; throw new Error("must not fetch"); }), errorIs("paid_model_blocked"));
    assert.equal(calls, 1);
  `));

  it("maps provider auth, limits and server errors without exposing raw details", () => serverTest(`
    for (const [status, code, mappedStatus] of [[401, "provider_auth", 503], [403, "provider_auth", 503],
      [402, "provider_limit", 429], [429, "provider_limit", 429], [500, "provider_unavailable", 503]]) {
      await assert.rejects(generateReply(config, config.model, [{ role: "user", content: "hi" }], undefined,
        async () => new Response("raw-provider-error " + config.apiKey, { status })), (error) => {
          errorIs(code, mappedStatus)(error);
          if (code === "provider_limit") assert.equal(error.retryAfter, 60);
          return true;
        });
    }
  `));

  it("maps malformed, oversized and empty provider replies to friendly errors", () => serverTest(`
    for (const response of [new Response("not json"), Response.json(null), Response.json([]), Response.json("raw-provider-error"), Response.json({ choices: [] }),
      Response.json({ choices: [{ message: { content: "  " } }] }),
      Response.json({ choices: [{ message: { content: "x".repeat(16001) } }] }),
      new Response("x".repeat(131073))])
      await assert.rejects(generateReply(config, config.model, [{ role: "user", content: "hi" }], undefined,
        async () => response), errorIs("provider_invalid"));
    await assert.rejects(generateReply(config, config.model, [{ role: "user", content: "hi" }], undefined,
      async () => { throw new DOMException("raw-provider-error " + config.apiKey, "TimeoutError"); }), errorIs("provider_timeout", 504));
  `));
});

describe("AI server configuration", () => {
  it("defaults to disabled and bounded free routing without a credential", () => serverTest(`
    const defaults = getAiConfig();
    assert.equal(defaults.enabled, false); assert.equal(defaults.ready, false);
    assert.equal(defaults.provider, "openrouter"); assert.equal(defaults.apiKey, "");
    assert.equal(defaults.model, "deepseek/deepseek-v4-flash-0731:free");
    assert.equal(defaults.fallbackModel, "openrouter/free");
    assert.deepEqual([defaults.userLimit, defaults.globalLimit, defaults.maxOutputTokens], [5, 40, 400]);
    assert.equal(defaults.ollamaUrl, "");
    process.env.AI_ENABLED = "TRUE"; process.env.AI_PROVIDER = "unknown";
    process.env.AI_DAILY_USER_LIMIT = "-2"; process.env.AI_DAILY_GLOBAL_LIMIT = "Infinity";
    process.env.AI_MAX_OUTPUT_TOKENS = "wat";
    assert.equal(getAiConfig().enabled, false); assert.equal(getAiConfig().provider, "openrouter");
    assert.deepEqual([getAiConfig().userLimit, getAiConfig().globalLimit, getAiConfig().maxOutputTokens], [5, 40, 400]);
    process.env.AI_DAILY_USER_LIMIT = "999"; process.env.AI_DAILY_GLOBAL_LIMIT = "0";
    process.env.AI_MAX_OUTPUT_TOKENS = "999999";
    assert.deepEqual([getAiConfig().userLimit, getAiConfig().globalLimit, getAiConfig().maxOutputTokens], [50, 1, 1200]);
  `));

  it("permits Ollama only on a local development host and never on Vercel", () => serverTest(`
    process.env.AI_PROVIDER = "ollama"; process.env.AI_MODEL = "local-model";
    process.env.NODE_ENV = "development"; process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    assert.equal(getAiConfig().ready, true); assert.equal(getAiConfig().ollamaUrl, "http://127.0.0.1:11434");
    process.env.VERCEL = "1";
    assert.equal(getAiConfig().ready, false); assert.equal(getAiConfig().ollamaUrl, "");
    process.env.VERCEL = "";
    for (const url of ["https://example.com", "http://user:password@localhost:11434", "file:///tmp/model", "not a URL"]) {
      process.env.OLLAMA_BASE_URL = url;
      assert.equal(getAiConfig().ready, false); assert.equal(getAiConfig().ollamaUrl, "");
    }
    process.env.OLLAMA_BASE_URL = "http://localhost:11434"; process.env.NODE_ENV = "production";
    assert.equal(getAiConfig().ready, false);
  `));
});
