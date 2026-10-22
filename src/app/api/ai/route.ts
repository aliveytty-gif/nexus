import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getAiConfig } from "@/features/ai/config";
import { availableModels, generateReply } from "@/features/ai/provider";
import { AiError, boundedJson, validateChat } from "@/features/ai/validation";

export const maxDuration = 60;
export const runtime = "nodejs";
type Reservation = { allowed: boolean; code?: string; request_id?: string; user_remaining: number; global_remaining: number; retry_after?: number };

export async function POST(request: Request) {
  const headers: Record<string, string> = { "Cache-Control": "no-store, private" };
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
  let reservation: Reservation | undefined;
  let requestId: string | undefined;
  let supabase: Awaited<ReturnType<typeof createClient>> | undefined;
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
    const models = await availableModels(config, request.signal);
    supabase = await createClient();
    for (let index = 0; index < models.length; index++) {
      const { data, error } = await supabase.rpc("reserve_ai_request", {
        p_user_limit: config.userLimit, p_global_limit: config.globalLimit,
        ...(requestId ? { p_request_id: requestId } : {}),
      });
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
      try {
        const reply = await generateReply(config, models[index], messages, request.signal);
        return respond({ ...reply, userRemaining: reservation.user_remaining, globalRemaining: reservation.global_remaining });
      } catch (error) {
        if (request.signal.aborted || index === models.length - 1 || !(error instanceof AiError) ||
          !["provider_timeout", "provider_unavailable", "provider_invalid"].includes(error.code)) throw error;
      }
    }
    throw new AiError("no_free_model", "Бесплатные модели сейчас недоступны.");
  } catch (error) {
    const safe = error instanceof AiError ? error : new AiError("unavailable", "Не удалось получить ответ. Попробуй позже.");
    if (safe.retryAfter) headers["Retry-After"] = String(safe.retryAfter);
    // Never return/log provider errors, prompt text, session data or credentials.
    return respond({ error: safe.message, code: safe.code, retryAfter: safe.retryAfter,
      ...(reservation ? { userRemaining: reservation.user_remaining, globalRemaining: reservation.global_remaining } : {}),
    }, safe.status);
  } finally {
    if (supabase && requestId) {
      try { await supabase.rpc("finish_ai_request", { p_request_id: requestId }); } catch { /* Lease expires if cleanup fails. */ }
    }
  }
}
