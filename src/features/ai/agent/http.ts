import "server-only";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AiError } from "../validation";

export async function authenticatedAi(request: Request, write = false) {
  if (write) {
    const origin = request.headers.get("origin");
    const destination = new URL(request.url);
    const sameLoopback = process.env.NODE_ENV === "development" && request.headers.get("sec-fetch-site") === "same-origin" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname) &&
      ["localhost", "127.0.0.1", "[::1]"].map((host) => `${destination.protocol}//${host}${destination.port ? `:${destination.port}` : ""}`)
        .some((localOrigin) => origin === localOrigin && request.headers.get("host") === new URL(localOrigin).host);
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== destination.origin && !sameLoopback))
      throw new AiError("invalid_origin", "Открой AI на сайте NEXUS.", 403);
  }
  const user = await getCurrentUser();
  if (!user) throw new AiError("unauthorized", "Войди в NEXUS, чтобы пользоваться AI.", 401);
  return { user, db: await createClient() };
}
export function safeFailure(error: unknown) {
  if (error instanceof AiError) return error;
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
    return new AiError("timeout", "Запрос остановлен или достиг лимита времени. Можно повторить вопрос.", 504);
  return new AiError("unavailable", "Не удалось выполнить запрос. Повтори позже.");
}
export function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store, private" } }); }
export function errorResponse(error: unknown) {
  const safe = safeFailure(error); return json({ error: safe.message, code: safe.code }, safe.status);
}
