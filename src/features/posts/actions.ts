"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { POST_LIMIT, UUID_PATTERN, validateContent } from "./validation";
import { ownedImagePath } from "@/lib/storage";

export type PostFormState = { error?: string; content?: string };
export async function createPostAction(
  _previous: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  const user = await requireUser();
  const result = validateContent(formData.get("content"), POST_LIMIT);
  if (result.error) return result;
  const imageUrl = String(formData.get("image_url") ?? "").trim();
  const communityId = String(formData.get("community_id") ?? "").trim();
  if (communityId && !UUID_PATTERN.test(communityId))
    return { content: result.content, error: "Сообщество недоступно." };
  if (imageUrl && !ownedImagePath(imageUrl, "post-media", user.id))
    return { content: result.content, error: "Прикрепите фотографию заново." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .insert({ author_id: user.id, content: result.content, image_url: imageUrl || null, community_id: communityId || null })
    .select("id")
    .single();
  if (error)
    return {
      content: result.content,
      error:
        "Не удалось опубликовать. Проверьте соединение и попробуйте ещё раз.",
    };
  revalidatePath("/feed");
  if (communityId) {
    revalidatePath(`/communities/${communityId}`);
    redirect(`/communities/${communityId}?published=${data.id}`);
  }
  redirect(`/feed?published=${data.id}`);
}

export type LikeState = { error?: string };
export async function setPostLikeAction(
  postId: string,
  liked: boolean,
): Promise<LikeState> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(postId) || typeof liked !== "boolean")
    return { error: "Публикация недоступна." };
  const supabase = await createClient();
  const { error } = liked
    ? await supabase.from("post_likes").upsert(
        { post_id: postId, user_id: user.id },
        { onConflict: "post_id,user_id", ignoreDuplicates: true },
      )
    : await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", user.id);
  if (error) return { error: "Не удалось сохранить лайк. Повторите попытку." };
  revalidatePath("/feed");
  revalidatePath(`/posts/${postId}`);
  revalidatePath("/communities", "layout");
  return {};
}
