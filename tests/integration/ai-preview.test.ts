import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { AgentEvent, AgentRequest } from "../../src/features/ai/agent/contracts.ts";
import { consumeAgentStream } from "../../src/features/ai/agent/stream.ts";
import type { Database } from "../../src/types/database.ts";

const TEST_REF = "ktqfbbiiccyaedshjdco";
const UNPROTECTED = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
type Done = Extract<AgentEvent, { type: "done" }>;
type StoredTurn = { id: string; thread_id: string; question: string; answer: string; status: string; steps: number };

function required(name: string) {
  const value = process.env[name]?.trim();
  assert.ok(value, `Missing ${name}`);
  return value;
}

function isolatedTargets() {
  const database = new URL(required("NEXUS_STORAGE_TEST_URL"));
  assert.equal(required("NEXUS_STORAGE_TEST_PROJECT_REF"), TEST_REF, "Use the dedicated NEXUS test project");
  assert.equal(database.href, `https://${TEST_REF}.supabase.co/`, "Use the exact isolated Supabase origin");
  const app = new URL(required("NEXUS_AI_PREVIEW_BASE_URL"));
  const loopback = app.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname);
  const branchPreview = app.protocol === "https:" && /^nexus-git-[a-z0-9][a-z0-9-]*\.vercel\.app$/.test(app.hostname) && app.port === "";
  assert.ok(loopback || branchPreview, "Use loopback or the Vercel branch-specific Preview alias");
  assert.equal(app.pathname, "/");
  assert.equal(app.username + app.password + app.search + app.hash, "", "Use an origin without credentials or query parameters");
  return { database: database.origin, app: app.origin, branchPreview };
}

function safeStreamFailure(events: AgentEvent[]) {
  const failure = events.find((event) => event.type === "error");
  const safeCode = failure?.code.match(/^[a-z_]{1,64}$/)?.[0];
  return safeCode ? `AI stream error: ${safeCode}` : "AI stream ended without a saved answer";
}

test("isolated NEXUS application, Supabase Auth and real model end to end", {
  skip: process.env.NEXUS_AI_PREVIEW_RUN !== "1" && "Set NEXUS_AI_PREVIEW_RUN=1 to use the dedicated test project",
  timeout: 220_000,
}, async (t) => {
  const target = isolatedTargets();
  const admin = createClient<Database>(target.database, required("NEXUS_STORAGE_TEST_SERVICE_ROLE_KEY"), { auth: UNPROTECTED });
  const publishableKey = required("NEXUS_STORAGE_TEST_PUBLISHABLE_KEY");
  const bypass = target.branchPreview ? process.env.NEXUS_AI_PREVIEW_BYPASS : undefined;
  const createdUsers: string[] = [];

  function appFetch(path: string, cookie?: string, init: RequestInit = {}) {
    assert.match(path, /^\/ai$|^\/api\/ai(?:[/?]|$)/);
    const headers = new Headers(init.headers);
    if (cookie) headers.set("Cookie", cookie);
    if (bypass) headers.set("x-vercel-protection-bypass", bypass);
    return fetch(new URL(path, target.app), { ...init, headers, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(85_000) });
  }

  async function account() {
    const email = `nexus-ai-e2e-${randomUUID()}@example.com`;
    const password = `Aa1!-${randomUUID()}-${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ok(!error && data.user, `Disposable test account was not created (${error?.code ?? "unknown"})`);
    const userId = data.user.id;
    createdUsers.push(userId);

    const jar = new Map<string, string>();
    const client = createServerClient<Database>(target.database, publishableKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          for (const { name, value } of cookies) {
            if (value) jar.set(name, value);
            else jar.delete(name);
          }
        },
      },
    });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    assert.ok(!signedIn.error && signedIn.data.user.id === userId, `Supabase test sign-in failed (${signedIn.error?.code ?? "unknown"})`);
    const cookie = [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
    assert.ok([...jar.keys()].some((key) => key.startsWith(`sb-${TEST_REF}-auth-token`)), "Supabase SSR did not emit a session cookie for the test ref");
    return { userId, cookie, client };
  }

  function request(question: string, mode: AgentRequest["mode"]): AgentRequest {
    return { threadId: randomUUID(), turnId: randomUUID(), runId: randomUUID(), question, mode, consent: true, nexusContext: false };
  }

  async function stream(cookie: string, input: AgentRequest) {
    const response = await appFetch("/api/ai", cookie, {
      method: "POST",
      headers: { "content-type": "application/json", origin: target.app, "sec-fetch-site": "same-origin" },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 200, "Expected NDJSON from the authenticated AI endpoint");
    assert.match(response.headers.get("content-type") || "", /^application\/x-ndjson/);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    const events: AgentEvent[] = [];
    await consumeAgentStream(response, (event) => events.push(event));
    const start = events[0];
    assert.ok(start?.type === "start", "Stream must start with request identity");
    assert.equal(start.threadId, input.threadId);
    assert.equal(start.turnId, input.turnId);
    assert.equal(start.runId, input.runId);
    const done = events.at(-1);
    assert.ok(done?.type === "done", safeStreamFailure(events));
    assert.ok(done.answer.trim(), "The provider returned no answer");
    return { events, done };
  }

  async function history(cookie: string, input: AgentRequest, done: Done) {
    const response = await appFetch(`/api/ai/history?id=${input.threadId}`, cookie);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    const value = await response.json() as { turns: StoredTurn[] };
    assert.equal(value.turns.length, 1, "Expected a single stored turn");
    const [turn] = value.turns;
    assert.equal(turn.id, input.turnId);
    assert.equal(turn.thread_id, input.threadId);
    assert.equal(turn.question, input.question);
    assert.equal(turn.status, "complete", "History must record model completion");
    assert.ok(turn.answer === done.answer, "History must match the streamed answer");
    assert.equal(turn.steps, done.usage.calls, "Quota reservations must match model calls");
    return turn;
  }

  try {
    const anonymous = await appFetch("/api/ai/history");
    assert.equal(anonymous.status, 401, "The application should deny anonymous access through Preview protection");
    const schema = await admin.from("ai_threads").select("id").limit(0);
    assert.ok(!schema.error, `AI schema is unavailable in the isolated test project (${schema.error?.code ?? "unknown"})`);
    const a = await account();
    const b = await account();

    // This read verifies that the application accepts the isolated project's Auth cookie
    // before sending any data to an endpoint that mutates history or consumes model quota.
    for (const user of [a, b]) {
      const gate = await appFetch("/api/ai/history", user.cookie);
      assert.equal(gate.status, 200, "The application did not accept the isolated project session");
      const own = await gate.json() as { threads: unknown[] };
      assert.equal(own.threads.length, 0, "A disposable account should start with empty history");
    }
    const page = await appFetch("/ai", a.cookie);
    assert.equal(page.status, 200, "Authenticated AI page should render");
    assert.ok((await page.text()).includes("NEXUS AI"), "AI page did not render its expected title");

    const solve = request("Обязательно используй инструмент calculate: вычисли (17*23)+sqrt(81). Кратко объясни результат.", "solve");
    const quick = request("Назови одну пользу функции len в Python одним коротким предложением.", "quick");
    const foreignOrigin = await appFetch("/api/ai", a.cookie, {
      method: "POST", headers: { "content-type": "application/json", origin: "https://example.test", "sec-fetch-site": "cross-site" },
      body: JSON.stringify(solve),
    });
    assert.equal(foreignOrigin.status, 403, "The API must reject a cross-site POST");

    // Let both streams settle before cleanup, even if one loses the connection.
    const [solveResult, quickResult] = await Promise.allSettled([stream(a.cookie, solve), stream(b.cookie, quick)]);
    if (solveResult.status === "rejected") throw solveResult.reason;
    if (quickResult.status === "rejected") throw quickResult.reason;
    const solved = solveResult.value;
    const quickAnswer = quickResult.value;
    for (const { events, done } of [solved, quickAnswer]) {
      assert.ok(events.some((event) => event.type === "delta" && event.text.trim()), "The live model must emit incremental text");
      const quotas = events.flatMap((event) => event.type === "quota" ? [event.remaining] : []);
      assert.equal(quotas.length, done.usage.calls, "Each live model call should produce a reservation event");
      assert.ok(quotas.every((remaining, index) => index === 0 || remaining === quotas[index - 1] - 1), "User quota should decrease for each call");
    }
    assert.ok(solved.events.some((event) => event.type === "action" && event.action.tool === "calculate" && event.action.status === "complete"), "The real model did not complete a calculator call");
    assert.match(solved.done.answer, /\b400\b/);
    assert.ok(solved.done.usage.calls >= 2, "Expected multi-step execution");
    assert.equal(quickAnswer.done.usage.calls, 1);
    assert.equal(quickAnswer.done.usage.toolCalls, 0);
    t.diagnostic("Concurrent real model completions passed: Solve used calculate with result 400; Quick used one model call");

    await Promise.all([history(a.cookie, solve, solved.done), history(b.cookie, quick, quickAnswer.done)]);
    const replay = await stream(a.cookie, solve);
    assert.ok(replay.done.answer === solved.done.answer, "An identical request must replay its stored response");
    assert.ok(!replay.events.some((event) => event.type === "quota" || event.type === "delta"), "A repeated run must avoid a new model call and quota charge");
    await history(a.cookie, solve, solved.done);

    const otherHistory = await appFetch(`/api/ai/history?id=${solve.threadId}`, b.cookie);
    assert.equal(otherHistory.status, 404, "User B must not be able to read user A's chat");
    const directRead = await b.client.from("ai_turns").select("id").eq("id", solve.turnId);
    assert.ok(!directRead.error && directRead.data.length === 0, "Supabase RLS must hide user A's turn from user B");
    const otherDelete = await appFetch(`/api/ai/history?id=${solve.threadId}`, b.cookie, {
      method: "DELETE", headers: { origin: target.app, "sec-fetch-site": "same-origin" },
    });
    assert.ok([200, 404].includes(otherDelete.status));
    await history(a.cookie, solve, solved.done);

    const putMemory = (enabled: boolean, consent: boolean) => appFetch("/api/ai/memory", a.cookie, {
      method: "PUT", headers: { "content-type": "application/json", origin: target.app, "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ enabled, consent, content: "Тестовая учебная цель" }),
    });
    assert.equal((await putMemory(true, false)).status, 400);
    assert.equal((await putMemory(true, true)).status, 200);
    assert.deepEqual(await (await appFetch("/api/ai/memory", b.cookie)).json(), { enabled: false, content: "" });
    assert.deepEqual(await (await putMemory(false, false)).json(), { enabled: false, content: "" });
    const emptyMemory = await a.client.from("ai_preferences").select("enabled,content,consent_at").eq("user_id", a.userId).single();
    assert.ok(!emptyMemory.error);
    assert.deepEqual(emptyMemory.data, { enabled: false, content: "", consent_at: null });

    const deleted = await appFetch(`/api/ai/history?id=${solve.threadId}`, a.cookie, {
      method: "DELETE", headers: { origin: target.app, "sec-fetch-site": "same-origin" },
    });
    assert.equal(deleted.status, 200);
    assert.equal((await appFetch(`/api/ai/history?id=${solve.threadId}`, a.cookie)).status, 404);
    const cascade = await a.client.from("ai_turns").select("id").eq("id", solve.turnId);
    assert.ok(!cascade.error && cascade.data.length === 0, "Deleting a chat should remove its turns");
    t.diagnostic("Authenticated NDJSON, quota accounting, replay, history isolation and deletion, memory consent and erasure passed");

    if (process.env.NEXUS_AI_PREVIEW_SEARCH === "1") {
      // Separate disposable account avoids coupling Research coverage to another run's quota/cooldown.
      const researcher = await account();
      const research = request("Найди свежие новости об искусственном интеллекте за неделю. Сравни события по нескольким независимым источникам.", "research");
      const researched = await stream(researcher.cookie, research);
      assert.ok(researched.done.usage.searchCalls >= 2, "Expected multiple real search requests");
      assert.ok(researched.done.sources.some((source) => source.kind === "web"), "Expected a real web search source");
      for (const source of researched.done.sources) assert.match(source.url, /^https?:\/\//);
      t.diagnostic("Live Research returned web sources from multiple search calls");
    }
  } finally {
    const failures: string[] = [];
    for (const userId of createdUsers) {
      const removed = await admin.auth.admin.deleteUser(userId).catch(() => null);
      if (!removed || removed.error) failures.push(userId);
    }
    assert.deepEqual(failures, [], "Isolated test user cleanup failed; check these disposable IDs");
    t.diagnostic(`Deleted ${createdUsers.length} disposable users from the isolated test project`);
  }
});
