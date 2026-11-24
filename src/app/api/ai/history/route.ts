import { z } from "zod";
import { authenticatedAi, errorResponse, json } from "@/features/ai/agent/http";
import { AiError } from "@/features/ai/validation";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedAi(request);
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      if (!z.uuid().safeParse(id).success) throw new AiError("invalid_request", "Некорректный диалог.", 400);
      const [thread, turns] = await Promise.all([
        db.from("ai_threads").select("id,title,updated_at").eq("id", id).eq("user_id", user.id).maybeSingle(),
        db.from("ai_turns").select("*").eq("thread_id", id).eq("user_id", user.id).order("created_at").limit(250),
      ]);
      if (thread.error || turns.error) throw new AiError("history_unavailable", "История временно недоступна.");
      if (!thread.data) throw new AiError("not_found", "Диалог не найден.", 404);
      return json({ thread: thread.data, turns: (turns.data || []).map((turn) => turn.status === "running" && Date.parse(turn.lease_expires_at) <= Date.now()
        ? { ...turn, status: "failed", error_code: "interrupted" } : turn) });
    }
    const { data, error } = await db.from("ai_threads").select("id,title,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(100);
    if (error) throw new AiError("history_unavailable", "История AI пока недоступна. Требуется подключённая база с миграцией AI.");
    return json({ threads: data || [] });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    const { db, user } = await authenticatedAi(request, true);
    const id = new URL(request.url).searchParams.get("id");
    if (!z.uuid().safeParse(id).success) throw new AiError("invalid_request", "Некорректный диалог.", 400);
    const { error } = await db.from("ai_threads").delete().eq("id", id!).eq("user_id", user.id);
    if (error) throw new AiError("delete_failed", "Не удалось удалить диалог.");
    return json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
