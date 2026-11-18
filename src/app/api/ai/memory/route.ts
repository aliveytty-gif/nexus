import { authenticatedAi, errorResponse, json } from "@/features/ai/agent/http";
import { preferencesSchema } from "@/features/ai/agent/contracts";
import { AiError, boundedJson } from "@/features/ai/validation";

export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedAi(request);
    const { data, error } = await db.from("ai_preferences").select("enabled,content").eq("user_id", user.id).maybeSingle();
    if (error) throw new AiError("memory_unavailable", "Настройки памяти недоступны.");
    return json(data || { enabled: false, content: "" });
  } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    const { db, user } = await authenticatedAi(request, true);
    const value = preferencesSchema.safeParse(await boundedJson(request, 10000));
    if (!value.success) throw new AiError("invalid_request", "Проверь текст памяти и отдельное согласие.", 400);
    const { enabled, content } = value.data;
    const { error } = await db.from("ai_preferences").upsert({ user_id: user.id, enabled,
      content: enabled ? content : "", consent_at: enabled ? new Date().toISOString() : null, updated_at: new Date().toISOString() });
    if (error) throw new AiError("memory_unavailable", "Не удалось сохранить настройки памяти.");
    return json({ enabled, content: enabled ? content : "" });
  } catch (error) { return errorResponse(error); }
}
