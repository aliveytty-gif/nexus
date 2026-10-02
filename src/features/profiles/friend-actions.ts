"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { UUID_PATTERN } from "@/features/posts/validation";

export async function changeFriendship(otherId: string, intent: "request" | "accept" | "remove"): Promise<{ error?: string }> {
  const user = await requireUser("/people");
  if (!UUID_PATTERN.test(otherId) || otherId === user.id) return { error: "Выберите другого участника." };
  const supabase = await createClient();
  if (intent === "request") {
    const { error } = await supabase.from("friendships").insert({ requester_id: user.id, addressee_id: otherId });
    if (error && error.code !== "23505") return { error: "Не удалось отправить заявку." };
  } else if (intent === "accept" || intent === "remove") {
    const { data: relationship, error: readError } = await supabase.from("friendships").select("id")
      .or(`and(requester_id.eq.${user.id},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${user.id})`).maybeSingle();
    if (readError || !relationship) return { error: "Заявка уже изменилась. Обновите страницу." };
    const result = intent === "accept"
      ? await supabase.from("friendships").update({ status: "accepted" }).eq("id", relationship.id)
        .eq("addressee_id", user.id).eq("status", "pending").select("id").maybeSingle()
      : await supabase.from("friendships").delete().eq("id", relationship.id).select("id").maybeSingle();
    if (result.error || !result.data) return { error: "Не удалось изменить заявку." };
  } else return { error: "Неизвестное действие." };
  revalidatePath("/people");
  revalidatePath("/profile/[username]", "page");
  return {};
}
