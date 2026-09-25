import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { UUID_PATTERN } from "./validation";

export const POSTS_PER_PAGE = 20;
const postSelect =
  "id,content,image_url,created_at,author_id,community_id,community:communities(id,name),author:profiles!posts_author_id_fkey(id,first_name,last_name,username,avatar_url,group_name),comments(count),likes:post_likes(count),my_like:post_likes(user_id)";
export async function getPosts(page = 1, authorId?: string, communityId?: string) {
  const user = await requireUser();
  const supabase = await createClient();
  let query = supabase.from("posts").select(postSelect, { count: "exact" }).eq("my_like.user_id", user.id);
  if (authorId) query = query.eq("author_id", authorId);
  if (communityId) query = query.eq("community_id", communityId);
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
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(postSelect)
    .eq("my_like.user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Не удалось загрузить публикацию.");
  return data;
}
