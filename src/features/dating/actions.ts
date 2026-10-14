"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { UUID_PATTERN } from "@/features/posts/validation";
import { ownedPostFilePath } from "@/lib/storage";
import { startConversationAction } from "@/features/messages/actions";
import type { DatingState } from "./types";

export async function saveDatingProfileAction(_previous: DatingState, formData: FormData): Promise<DatingState> {
  const user = await requireUser("/dating");
  const bio = String(formData.get("bio") ?? "").trim();
  const ageText = String(formData.get("age") ?? "").trim();
  const age = ageText ? Number(ageText) : null;
  let paths: unknown;
  try { paths = JSON.parse(String(formData.get("photo_paths") ?? "[]")); }
  catch { return { error: "Выберите фотографии заново." }; }
  if (bio.length > 500 || (age !== null && (!Number.isInteger(age) || age < 18 || age > 100)))
    return { error: "Описание — до 500 символов, возраст — от 18 до 100 лет или пустое поле." };
  if (!Array.isArray(paths) || paths.length > 6 || new Set(paths).size !== paths.length ||
    paths.some((path) => typeof path !== "string" || !ownedPostFilePath(path, user.id) || !/\.(jpg|jpeg|png|webp)$/.test(path)))
    return { error: "Можно выбрать до шести собственных фотографий." };
  const supabase = await createClient();
  const { data: old } = await supabase.from("dating_profiles").select("photo_paths").eq("user_id", user.id).maybeSingle();
  const { error } = await supabase.rpc("save_dating_profile", {
    p_enabled: formData.get("enabled") === "on", p_bio: bio, p_age: age, p_photo_paths: paths as string[],
  });
  if (error) return { error: "Не удалось сохранить анкету. Проверьте фотографии и повторите." };
  const removed = old?.photo_paths.filter((path) => !(paths as string[]).includes(path)) ?? [];
  if (removed.length) await supabase.storage.from("dating-photos").remove(removed);
  revalidatePath("/dating");
  return { success: "Настройки знакомств сохранены." };
}

export async function reactToDatingAction(otherId: string, _previous: DatingState, formData: FormData): Promise<DatingState> {
  const user = await requireUser("/dating");
  const reaction = formData.get("reaction");
  if (!UUID_PATTERN.test(otherId) || otherId === user.id || (reaction !== "liked" && reaction !== "skipped"))
    return { error: "Анкета недоступна. Обновите страницу." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("react_to_dating_profile", { p_target_user_id: otherId, p_reaction: reaction });
  if (error) return { error: "Не удалось сохранить реакцию. Анкета могла стать недоступной." };
  revalidatePath("/dating");
  if (data) redirect("/dating?tab=matches&matched=1");
  return {};
}

export async function blockDatingUserAction(otherId: string, blocked: boolean): Promise<DatingState> {
  const user = await requireUser("/dating");
  if (!UUID_PATTERN.test(otherId) || otherId === user.id) return { error: "Участник недоступен." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_block", { p_user_id: otherId, p_blocked: blocked });
  if (error) return { error: "Не удалось изменить блокировку. Повторите попытку." };
  revalidatePath("/dating");
  revalidatePath("/people");
  revalidatePath("/messages");
  return { success: blocked ? "Пользователь заблокирован." : "Блокировка снята." };
}

export async function reportDatingUserAction(otherId: string, _previous: DatingState, formData: FormData): Promise<DatingState> {
  const user = await requireUser("/dating");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID_PATTERN.test(otherId) || otherId === user.id || !reason || reason.length > 1000)
    return { error: "Опишите причину жалобы, до 1000 символов." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_dating_profile", { p_user_id: otherId, p_reason: reason });
  if (!error) revalidatePath("/dating");
  return error ? { error: "Не удалось отправить жалобу. Повторите попытку." } : { success: "Жалоба сохранена. Вы также можете заблокировать пользователя." };
}

export async function openDatingChatAction(otherId: string): Promise<DatingState> {
  const user = await requireUser("/dating");
  if (!UUID_PATTERN.test(otherId) || otherId === user.id) return { error: "Участник недоступен." };
  const [a, b] = [user.id, otherId].sort();
  const supabase = await createClient();
  const { data, error } = await supabase.from("dating_matches").select("id").eq("user_a", a).eq("user_b", b).maybeSingle();
  if (error || !data) return { error: "Взаимная симпатия больше недоступна. Обновите страницу." };
  return startConversationAction(otherId);
}
