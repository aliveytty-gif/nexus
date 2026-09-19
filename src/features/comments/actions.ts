"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  COMMENT_LIMIT,
  UUID_PATTERN,
  validateContent,
} from "@/features/posts/validation";
export type CommentFormState = { error?: string; content?: string };
export async function createCommentAction(
  postId: string,
  _previous: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(postId)) return { error: "Публикация не найдена." };
  const result = validateContent(formData.get("content"), COMMENT_LIMIT);
  if (result.error) return result;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .insert({ post_id: postId, author_id: user.id, content: result.content })
    .select("id")
    .single();
  if (error)
    return {
      content: result.content,
      error:
        "Не удалось отправить комментарий. Возможно, публикация удалена. Попробуйте обновить страницу.",
    };
  revalidatePath(`/posts/${postId}`);
  revalidatePath("/feed");
  redirect(`/posts/${postId}?commented=${data.id}#comments`);
}
export async function deleteCommentAction(
  postId: string,
  commentId: string,
): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(postId) || !UUID_PATTERN.test(commentId))
    return { error: "Комментарий не найден." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId)
    .eq("post_id", postId)
    .eq("author_id", user.id);
  if (error)
    return { error: "Не удалось удалить комментарий. Попробуйте ещё раз." };
  revalidatePath(`/posts/${postId}`);
  revalidatePath("/feed");
  return {};
}
