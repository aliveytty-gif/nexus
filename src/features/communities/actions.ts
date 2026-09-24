"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ownedImagePath } from "@/lib/storage";
import { UUID_PATTERN } from "@/features/posts/validation";

export type CommunityFormState = {
  error?: string;
  name?: string;
  description?: string;
  type?: "group" | "channel";
};

export async function createCommunityAction(
  _previous: CommunityFormState,
  formData: FormData,
): Promise<CommunityFormState> {
  const user = await requireUser("/communities/new");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const avatarUrl = String(formData.get("avatar_url") ?? "").trim();
  const values = { name, description, type: type === "channel" ? "channel" as const : "group" as const };
  if (!name || name.length > 100)
    return { ...values, error: "Название должно содержать от 1 до 100 символов." };
  if (description.length > 1000)
    return { ...values, error: "Описание должно быть не длиннее 1 000 символов." };
  if (type !== "group" && type !== "channel")
    return { ...values, error: "Выберите группу или канал." };
  if (avatarUrl && !ownedImagePath(avatarUrl, "avatars", user.id))
    return { ...values, error: "Загрузите фото сообщества заново." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_community", {
    p_name: name, p_description: description, p_type: type,
    p_avatar_url: avatarUrl || null,
  });
  if (error || !data) return { ...values, error: "Не удалось создать сообщество. Попробуйте ещё раз." };
  revalidatePath("/communities");
  redirect(`/communities/${data}`);
}

export async function membershipAction(
  communityId: string,
  join: boolean,
): Promise<{ error?: string }> {
  if (!UUID_PATTERN.test(communityId)) return { error: "Сообщество не найдено." };
  const user = await requireUser(`/communities/${communityId}`);
  const supabase = await createClient();
  if (join) {
    const { error } = await supabase.from("community_members")
      .insert({ community_id: communityId, user_id: user.id });
    if (error && error.code !== "23505")
      return { error: "Не удалось вступить. Попробуйте ещё раз." };
  } else {
    const { data, error } = await supabase.from("community_members").delete()
      .eq("community_id", communityId).eq("user_id", user.id).select("user_id");
    if (error || !data.length) return { error: "Не удалось выйти из сообщества." };
  }
  revalidatePath(`/communities/${communityId}`);
  revalidatePath("/communities");
  return {};
}
