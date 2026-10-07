import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { UUID_PATTERN } from "./validation";
import { parseAttachments } from "@/lib/storage";

export const POSTS_PER_PAGE = 20;
const postSelect =
  "id,content,image_url,attachments,created_at,author_id,community_id,community:communities(id,name),author:profiles!posts_author_id_fkey(id,first_name,last_name,username,avatar_url,group_name),comments(count),likes:post_likes(count),my_like:post_likes(user_id)";

async function signPostAttachments<T extends { attachments: unknown }>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  posts: T[],
) {
  const attachments = posts.map((post) => parseAttachments(post.attachments));
  // These paths came from posts returned through RLS; Storage checks access again.
  const paths = [...new Set(attachments.flatMap((files) => files.map((file) => file.path)))];
  const signed = paths.length
    ? await supabase.storage.from("post-files").createSignedUrls(paths, 600)
    : null;
  const urls = new Map(signed?.data?.map((file) => [file.path, file.signedUrl]));
  return posts.map((post, index) => ({
    ...post,
    mediaAttachments: attachments[index].map((attachment) => {
      const url = urls.get(attachment.path) || null;
      const download = url ? new URL(url) : null;
      if (download) download.searchParams.set("download", attachment.name);
      return { ...attachment, url, downloadUrl: download?.href ?? null };
    }),
  }));
}
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
  return { posts: await signPostAttachments(supabase, data), count: count ?? 0 };
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
  return data ? (await signPostAttachments(supabase, [data]))[0] : null;
}
