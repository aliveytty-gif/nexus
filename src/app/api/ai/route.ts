import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getAiConfig } from "@/features/ai/config";
import { availableModels, generateReply } from "@/features/ai/provider";
import { AiError, boundedJson, validateChat } from "@/features/ai/validation";
import { parseZeroGpuRequestId, stopZeroGpuReply, streamZeroGpuReply, zeroGpuMessages, zeroGpuOperationId } from "@/features/ai/zerogpu";

export const maxDuration = 60;
export const runtime = "nodejs";
type Reservation = { allowed: boolean; code?: string; request_id?: string; user_remaining: number; global_remaining: number; retry_after?: number };
const privateHeaders = { "Cache-Control": "no-store, private" };
const safeError = (error: unknown) => error instanceof AiError ? error : new AiError("unavailable", "Не удалось получить ответ. Попробуй позже.");

async function authorizedUser(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin))
    throw new AiError("invalid_origin", "Открой AI на сайте NEXUS.", 403);
  const user = await getCurrentUser();
  if (!user) throw new AiError("unauthorized", "Войди в NEXUS, чтобы пользоваться AI.", 401);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AiError("invalid_request", "Не удалось прочитать сообщение.", 415);
  return user;
}

export async function DELETE(request: Request) {
  try {
    const user = await authorizedUser(request);
    const config = getAiConfig();
    if (!config.enabled || !config.ready || config.provider !== "zerogpu")
      throw new AiError("not_configured", "Демо ZeroGPU сейчас недоступно.");
    const input = await boundedJson(request, 256);
    const clientId = parseZeroGpuRequestId(input);
    const operationId = zeroGpuOperationId(config.zeroGpuToken, user.id, clientId);
    const proof = (input as Record<string, unknown>).stopProof;
    if (typeof proof !== "string" || !/^[0-9a-f-]{36}$/.test(proof) ||
        !timingSafeEqual(Buffer.from(proof, "ascii"), Buffer.from(operationId, "ascii")))
      throw new AiError("not_found", "Запрос на остановку недоступен.", 404);
    const stopped = await stopZeroGpuReply(config.zeroGpuToken, operationId);
    return Response.json({ stopped }, { status: stopped ? 200 : 202, headers: privateHeaders });
  } catch (error) {
    const safe = safeError(error);
    return Response.json({ error: safe.message, code: safe.code }, { status: safe.status, headers: privateHeaders });
  }
}

export async function POST(request: Request) {
  const headers: Record<string, string> = { ...privateHeaders };
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
  let reservation: Reservation | undefined;
  let requestId: string | undefined;
  let supabase: Awaited<ReturnType<typeof createClient>> | undefined;
  let streaming = false;
  const finish = async () => {
    if (supabase && requestId) {
      try { await supabase.rpc("finish_ai_request", { p_request_id: requestId }).abortSignal(AbortSignal.timeout(2500)); }
      catch { /* Lease expires if cleanup fails. */ }
    }
  };
  try {
    const user = await authorizedUser(request);
    const input = await boundedJson(request, 65536);
    const messages = validateChat(input);
    const config = getAiConfig();
    if (!config.enabled || !config.ready) throw new AiError("not_configured", "NEXUS AI пока не подключён. Попробуй позже.");
    // Validate the ZeroGPU operation and budget before reserving a permanent quota.
    const zeroGpu = config.provider === "zerogpu" ? {
      operationId: zeroGpuOperationId(config.zeroGpuToken, user.id, parseZeroGpuRequestId(input)),
      messages: zeroGpuMessages(messages),
    } : undefined;
    const deadline = zeroGpu && AbortSignal.timeout(50000);
    const reservationSignal = deadline ? AbortSignal.any([request.signal, deadline]) : request.signal;
    const models = await availableModels(config, reservationSignal);
    supabase = await createClient();
    for (let index = 0; index < models.length; index++) {
      const { data, error } = await supabase.rpc("reserve_ai_request", {
        p_user_limit: config.userLimit, p_global_limit: config.globalLimit,
        ...(requestId ? { p_request_id: requestId } : {}),
      }).abortSignal(reservationSignal);
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
      if (zeroGpu) {
        const upstream = new AbortController();
        const signal = AbortSignal.any([reservationSignal, upstream.signal]);
        const quotas = { userRemaining: reservation.user_remaining, globalRemaining: reservation.global_remaining };
        const encoder = new TextEncoder();
        let cancelled = false;
        let completion: Promise<void> | undefined;
        // A disconnect may reclaim the function. Keep remote Stop and lease cleanup alive.
        after(async () => { await completion; });
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const emit = (event: unknown) => {
              if (!cancelled && !request.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            };
            completion = (async () => {
              try {
                emit({ type: "meta", ...quotas, stopProof: zeroGpu.operationId });
                for await (const event of streamZeroGpuReply({
                  ...zeroGpu, token: config.zeroGpuToken, maxTokens: config.maxOutputTokens, signal,
                })) emit(event);
              } catch (error) {
                const safe = safeError(error);
                emit({ type: "error", code: safe.code, error: safe.message });
              } finally {
                await finish();
                if (!cancelled) controller.close();
              }
            })();
          },
          async cancel() {
            cancelled = true;
            upstream.abort();
            await completion;
          },
        });
        streaming = true;
        return new Response(body, { headers: {
          "Cache-Control": "no-store, private, no-transform",
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "X-Accel-Buffering": "no",
        } });
      }
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
    const safe = safeError(error);
    if (safe.retryAfter) headers["Retry-After"] = String(safe.retryAfter);
    // Never return/log provider errors, prompt text, session data or credentials.
    return respond({ error: safe.message, code: safe.code, retryAfter: safe.retryAfter,
      ...(reservation ? { userRemaining: reservation.user_remaining, globalRemaining: reservation.global_remaining } : {}),
    }, safe.status);
  } finally {
    if (!streaming) await finish();
  }
}
