import "server-only";
import { createClient } from "@/lib/supabase/server";
import { UUID_PATTERN } from "./validation";

export const POSTS_PER_PAGE = 20;
const postSelect =
  "id,content,created_at,author_id,author:profiles!posts_author_id_fkey(id,first_name,last_name,username,avatar_url,group_name),comments(count)";
export async function getPosts(page = 1, authorId?: string) {
  const supabase = await createClient();
  let query = supabase.from("posts").select(postSelect, { count: "exact" });
  if (authorId) query = query.eq("author_id", authorId);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE - 1);
  if (error)
    throw new Error(
      "Не удалось загрузить публикации. Проверьте подключение и миграции.",
    );
  return { posts: data, count: count ?? 0 };
}
export type FeedPost = Awaited<ReturnType<typeof getPosts>>["posts"][number];
export async function getPost(id: string) {
  if (!UUID_PATTERN.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(postSelect)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Не удалось загрузить публикацию.");
  return data;
}
