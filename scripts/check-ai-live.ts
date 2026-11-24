// Explicit live check: synthetic prompts only, no production DB or personal messages.
// Run with Node 22+ --env-file=.env.local --experimental-strip-types.
import { createClient } from "@supabase/supabase-js";
import { readAgentConfig } from "../src/features/ai/agent/config.ts";
import { newUsage, resolveModels, runAgent } from "../src/features/ai/agent/engine.ts";
import type { AgentMode, Source } from "../src/features/ai/agent/contracts.ts";
import type { Database } from "../src/types/database.ts";
import { searchWeb } from "../src/features/ai/agent/web.ts";

const config = readAgentConfig(process.env);
const cases = {
  calculator: {
    question: "Обязательно используй инструмент calculate: вычисли (17*23)+sqrt(81). Кратко объясни результат.",
    mode: "solve",
  },
  python: {
    question: "В этом Python-коде список из трёх значений. Найди ошибку, объясни её и покажи исправленный код:\nfor i in range(len(values) + 1):\n    print(values[i])",
    mode: "quick",
  },
  plan: {
    question: "У меня есть 2 часа в день. Составь план изучения Python на месяц. Дай четыре недельные цели и объясни порядок тем.",
    mode: "auto",
  },
  page: {
    question: "Прочитай страницу https://www.iana.org/domains/reserved через readWebPage и объясни, для чего существуют домены example.",
    mode: "auto",
  },
} satisfies Record<string, { question: string; mode: AgentMode }>;
const check = process.argv[2] || "calculator";

async function main() {
  if (check === "search") {
    const sources = await searchWeb(config, "latest NASA science news", "pw", AbortSignal.timeout(15000));
    if (!sources.length) throw new Error("Search returned no valid public sources.");
    console.log(JSON.stringify({ check, provider: config.searchProvider, sources: sources.map(({ title, url }) => ({ title, url })) }));
    return;
  }
  if (!config.ready || !config.freeOnly) throw new Error("Live check requires configured free-only AI.");
  if (!Object.hasOwn(cases, check)) throw new Error("Use calculator, python, plan, page, or search.");
  const { question, mode } = cases[check as keyof typeof cases];
  const signal = AbortSignal.timeout(65000);
  const models = await resolveModels(config, mode !== "quick", signal);
  const usage = newUsage(models[0]);
  const events: string[] = [];
  const sources: Source[] = [];
  const db = createClient<Database>("https://live-check-unused.supabase.co", "public-placeholder", { auth: { persistSession: false } });
  const answer = await runAgent({
    config, models, usage, signal, db, userId: "11111111-1111-4111-8111-111111111111",
    question, mode, messages: [{ role: "user", content: question }], memory: "", nexusContext: false,
    maxTools: 3, sources, actions: [], reserve: async () => {},
    emit: (event) => {
      if (event.type === "action") events.push(event.action.tool + ":" + event.action.status);
    },
  });
  console.log(JSON.stringify({ check, answer, events, sources, usage }));
  if (check === "calculator" && (!events.includes("calculate:complete") || !answer.includes("400")))
    throw new Error("Tool/result not verified.");
  if (check === "page" && (!events.includes("readWebPage:complete") || sources.length === 0))
    throw new Error("Page reading not verified.");
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    check,
    code: error && typeof error === "object" && "code" in error ? error.code : "live_check_failed",
    name: error instanceof Error ? error.name : "error",
  }));
  process.exitCode = 1;
});
