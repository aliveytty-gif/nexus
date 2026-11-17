import { readAgentConfig } from "@/features/ai/agent/config";
import { requestSchema, modeSettings, validSources, type Action, type AgentEvent, type Source } from "@/features/ai/agent/contracts";
import { authenticatedAi, errorResponse, safeFailure } from "@/features/ai/agent/http";
import { newUsage, resolveModels, runAgent } from "@/features/ai/agent/engine";
import { conversationContext } from "@/features/ai/agent/context";
import { AiError, boundedJson } from "@/features/ai/validation";
import type { AiTurn } from "@/types/ai-database";
import type { Json } from "@/types/database";

export const maxDuration = 90;
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { user, db } = await authenticatedAi(request, true);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AiError("invalid_request", "Нужен JSON-запрос.", 415);
    const parsed = requestSchema.safeParse(await boundedJson(request, 20000));
    if (!parsed.success) throw new AiError("invalid_request", "Проверь вопрос, режим и согласие на обработку.", 400);
    const input = parsed.data;
    const config = readAgentConfig(process.env);
    if (!config.enabled || !config.ready) throw new AiError("not_configured", "NEXUS AI пока не подключён.");
    const started = await db.rpc("begin_ai_turn", { p_thread_id: input.threadId, p_turn_id: input.turnId, p_run_id: input.runId, p_question: input.question, p_mode: input.mode });
    if (started.error || !started.data) throw new AiError(started.error?.code === "55P03" ? "busy" : "history_unavailable",
      started.error?.code === "55P03" ? "Предыдущий запрос ещё выполняется. Дождись его окончания." : "История AI недоступна. Проверь подключение и миграцию базы.", started.error?.code === "55P03" ? 409 : 503);
    const start = started.data as unknown as { replay: boolean; turn: AiTurn };
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(config.timeoutMs)]);
    let closed = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(stream) {
        const emit = (event: AgentEvent) => { if (!closed) { try { stream.enqueue(encoder.encode(JSON.stringify(event) + "\n")); } catch { closed = true; controller.abort(); } } };
        const usage = newUsage(config.model); const sources: Source[] = []; const actions: Action[] = [];
        let answer = ""; let completed = false;
        emit({ type: "start", threadId: input.threadId, turnId: input.turnId, runId: input.runId });
        try {
          if (start.replay) {
            if (start.turn.status === "complete") emit({ type: "done", answer: start.turn.answer, sources: validSources(start.turn.sources), usage: start.turn.usage as unknown as typeof usage });
            else emit({ type: "error", code: "request_replayed", message: start.turn.status === "running" ? "Этот запрос уже выполняется. Обнови историю через несколько секунд." : "Предыдущая попытка завершилась без ответа. Нажми «Повторить»." });
            return;
          }
          emit({ type: "status", text: "Загружаю контекст и проверяю доступные инструменты…" });
          const [threadResult, turnsResult, memoryResult, models] = await Promise.all([
            db.from("ai_threads").select("*").eq("id", input.threadId).eq("user_id", user.id).abortSignal(signal).single(),
            db.from("ai_turns").select("*").eq("thread_id", input.threadId).eq("user_id", user.id).neq("id", input.turnId).order("created_at", { ascending: false }).limit(50).abortSignal(signal),
            db.from("ai_preferences").select("content,enabled").eq("user_id", user.id).abortSignal(signal).maybeSingle(),
            resolveModels(config, input.mode !== "quick", signal),
          ]);
          if (threadResult.error || turnsResult.error || memoryResult.error) throw new AiError("history_unavailable", "Не удалось прочитать историю или настройки памяти.");
          const reserve = async (minimumRemaining = 0) => {
            signal.throwIfAborted();
            const { data, error } = await db.rpc("reserve_ai_agent_step", { p_turn_id: input.turnId, p_run_id: input.runId, p_user_limit: config.userLimit, p_global_limit: config.globalLimit, p_min_remaining: minimumRemaining });
            if (error || !data) throw new AiError("quota_unavailable", "Не удалось проверить лимит AI.");
            const quota = data as { allowed?: boolean; code?: string; user_remaining?: number; global_remaining?: number; minute_remaining?: number };
            if (typeof quota.user_remaining === "number") emit({ type: "quota", remaining: quota.user_remaining });
            if (!quota.allowed) throw new AiError(quota.code || "rate_limit", quota.code === "user_limit" ? "Твой дневной лимит обращений к модели исчерпан." : quota.code === "global_limit" ? "Общий дневной лимит AI исчерпан." : "Сейчас превышен лимит запросов. Подожди немного.", 429);
            return Math.min(quota.user_remaining ?? 0, quota.global_remaining ?? 0, quota.minute_remaining ?? 0);
          };
          const context = await conversationContext({ thread: threadResult.data, turns: (turnsResult.data || []).reverse(), question: input.question, config, models, usage,
            reserve: () => reserve(1), signal, summarize: input.mode !== "quick" });
          emit({ type: "status", text: input.mode === "quick" ? "Готовлю короткий ответ…" : "Выбираю действия для твоего вопроса…" });
          answer = await runAgent({ config, db, userId: user.id, question: input.question, mode: input.mode, models,
            nexusContext: input.nexusContext, signal, usage, sources, actions, emit, reserve,
            maxTools: Math.min(config.maxToolCalls, modeSettings[input.mode].tools), messages: context.messages,
            memory: memoryResult.data?.enabled ? memoryResult.data.content : "",
          });
          signal.throwIfAborted();
          const saved = await db.rpc("finish_ai_turn", { p_turn_id: input.turnId, p_run_id: input.runId, p_status: "complete", p_answer: answer,
            p_sources: sources as unknown as Json, p_actions: actions as unknown as Json, p_usage: usage as unknown as Json,
            ...(context.summaryThrough ? { p_summary: context.summary, p_summary_through: context.summaryThrough } : {}),
          });
          if (saved.error || !saved.data) throw new AiError("save_failed", "Ответ получен, но сохранить его не удалось. Скопируй текст и обнови историю.");
          completed = true; emit({ type: "done", answer, sources, usage });
        } catch (error) {
          const safe = safeFailure(error);
          console.warn("nexus_ai", { code: safe.code, runId: input.runId });
          emit({ type: "error", code: safe.code, message: safe.message });
          if (!start.replay) {
            const result = await db.rpc("finish_ai_turn", { p_turn_id: input.turnId, p_run_id: input.runId,
              p_status: request.signal.aborted || controller.signal.aborted ? "cancelled" : "failed", p_answer: "", p_sources: [], p_actions: [], p_usage: usage as unknown as Json, p_error_code: safe.code });
            if (result.error) console.warn("nexus_ai", { code: "cleanup_failed", runId: input.runId });
          }
        } finally {
          if (!completed) controller.abort();
          if (!closed) { closed = true; stream.close(); }
        }
      },
      cancel() { closed = true; controller.abort(); },
    });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, private", "X-Accel-Buffering": "no" } });
  } catch (error) { return errorResponse(error); }
}
