"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { POST_LIMIT, validateContent } from "./validation";

export type PostFormState = { error?: string; content?: string };
export async function createPostAction(
  _previous: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  const user = await requireUser();
  const result = validateContent(formData.get("content"), POST_LIMIT);
  if (result.error) return result;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .insert({ author_id: user.id, content: result.content })
    .select("id")
    .single();
  if (error)
    return {
      content: result.content,
      error:
        "Не удалось опубликовать. Проверьте соединение и попробуйте ещё раз.",
    };
  revalidatePath("/feed");
  redirect(`/feed?published=${data.id}`);
}
