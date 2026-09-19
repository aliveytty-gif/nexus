import "server-only";
import { createClient } from "@/lib/supabase/server";
export const COMMENTS_PER_PAGE = 30;
export async function getComments(postId: string, page = 1) {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("comments")
    .select(
      "id,post_id,author_id,content,created_at,author:profiles!comments_author_id_fkey(id,first_name,last_name,username,avatar_url)",
      { count: "exact" },
    )
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * COMMENTS_PER_PAGE, page * COMMENTS_PER_PAGE - 1);
  if (error) throw new Error("Не удалось загрузить комментарии.");
  return { comments: data, count: count ?? 0 };
}
