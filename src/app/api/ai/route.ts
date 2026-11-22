import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getAiConfig } from "@/features/ai/config";
import { availableModels, generateReply, probeAi, providerMessages, streamReply } from "@/features/ai/provider";
import { AiError, boundedJson, validateChat } from "@/features/ai/validation";

export const maxDuration = 60;
export const runtime = "nodejs";
type Reservation = { allowed: boolean; code?: string; request_id?: string; user_remaining: number; global_remaining: number; retry_after?: number };
const privateHeaders = { "Cache-Control": "no-store, private" };
const safeError = (error: unknown) => error instanceof AiError ? error : new AiError("unavailable", "Не удалось получить ответ. Попробуй позже.");

export async function GET(request: Request) {
  if (!await getCurrentUser()) return Response.json({ error: "Войди в NEXUS.", code: "unauthorized" }, { status: 401, headers: privateHeaders });
  const config = getAiConfig();
  const status = !config.enabled || !config.ready ? "not_configured" : await probeAi(config, request.signal) ? "ready" : "unavailable";
  return Response.json({ status, provider: config.provider, model: config.model }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  const headers: Record<string, string> = { ...privateHeaders };
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
  const upstream = new AbortController();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55000), upstream.signal]);
  let reservation: Reservation | undefined;
  let requestId: string | undefined;
  let supabase: Awaited<ReturnType<typeof createClient>> | undefined;
  let streaming = false;
  let cleanup: Promise<void> | undefined;
  const finish = () => cleanup ??= (async () => {
    if (!supabase || !requestId) return;
    try { await supabase.rpc("finish_ai_request", { p_request_id: requestId }).abortSignal(AbortSignal.timeout(2500)); }
    catch { console.error("[NEXUS AI] quota_cleanup_failed"); }
  })();
  try {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin))
      throw new AiError("invalid_origin", "Открой AI на сайте NEXUS.", 403);
    if (!await getCurrentUser()) throw new AiError("unauthorized", "Войди в NEXUS, чтобы пользоваться AI.", 401);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AiError("invalid_request", "Не удалось прочитать сообщение.", 415);
    const messages = validateChat(await boundedJson(request, 65536));
    const config = getAiConfig();
    if (!config.enabled || !config.ready) throw new AiError("not_configured", "NEXUS AI пока не подключён. Попробуй позже.");
    providerMessages(config, messages); // Reject an oversized last question before consuming quota.
    const models = await availableModels(config, signal);
    supabase = await createClient();
    for (let index = 0; index < models.length; index++) {
      const { data, error } = await supabase.rpc("reserve_ai_request", {
        p_user_limit: config.userLimit, p_global_limit: config.globalLimit,
        ...(requestId ? { p_request_id: requestId } : {}),
      }).abortSignal(signal);
      if (error || !data || typeof data !== "object" || Array.isArray(data))
        throw new AiError("quota_unavailable", "AI временно недоступен. Попробуй позже.");
      reservation = data as unknown as Reservation;
      if (!reservation.allowed) {
        const reason = reservation.code;
        throw new AiError(reason || "rate_limit", reason === "user_limit" ? "Твой дневной лимит AI исчерпан. Возвращайся завтра." :
          reason === "global_limit" ? "Общий дневной лимит AI исчерпан. Возвращайся завтра." :
          reason === "busy" ? "Предыдущий запрос ещё выполняется. Подожди немного." : "Слишком много запросов. Подожди немного.", 429, reservation.retry_after || 10);
      }
      requestId = reservation.request_id;
      if (!requestId) throw new AiError("quota_unavailable", "AI временно недоступен.");
      if (config.provider === "ollama" && config.streaming) {
        const quotas = { userRemaining: reservation.user_remaining, globalRemaining: reservation.global_remaining };
        const encoder = new TextEncoder();
        let closed = false;
        streaming = true;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const emit = (event: unknown) => { if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
            void (async () => {
              try {
                emit({ type: "meta", ...quotas });
                for await (const text of streamReply(config, models[index], messages, signal)) emit({ type: "delta", text });
                emit({ type: "done" });
              } catch (error) {
                if (!closed && !request.signal.aborted && !upstream.signal.aborted) {
                  const safe = safeError(error);
                  console.error(`[NEXUS AI] ${safe.code}`);
                  emit({ type: "error", code: safe.code, error: safe.message });
                }
              } finally {
                await finish();
                if (!closed) { closed = true; controller.close(); }
              }
            })();
          },
          async cancel() { closed = true; upstream.abort(); await finish(); },
        });
        return new Response(body, { headers: { ...headers, "Cache-Control": "no-store, private, no-transform", "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no" } });
      }
      try {
        const reply = await generateReply(config, models[index], messages, signal);
        return respond({ ...reply, userRemaining: reservation.user_remaining, globalRemaining: reservation.global_remaining });
      } catch (error) {
        if (signal.aborted || index === models.length - 1 || !(error instanceof AiError) ||
          !["provider_timeout", "provider_unavailable", "provider_invalid"].includes(error.code)) throw error;
      }
    }
    throw new AiError("no_free_model", "Бесплатные модели сейчас недоступны.");
  } catch (error) {
    const safe = safeError(error);
    if (safe.status >= 500) console.error(`[NEXUS AI] ${safe.code}`);
    if (safe.retryAfter) headers["Retry-After"] = String(safe.retryAfter);
    return respond({ error: safe.message, code: safe.code, retryAfter: safe.retryAfter,
      ...(reservation ? { userRemaining: reservation.user_remaining, globalRemaining: reservation.global_remaining } : {}),
    }, safe.status);
  } finally {
    // The stream owns its lease until completion/error/cancellation. A route
    // finally alone would release the quota before generation had even begun.
    if (!streaming) await finish();
  }
}
