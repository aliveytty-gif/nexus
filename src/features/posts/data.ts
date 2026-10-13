import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { UUID_PATTERN } from "./validation";
import { parseAttachments } from "@/lib/storage";
import type { QueryData } from "@supabase/supabase-js";

export const POSTS_PER_PAGE = 20;
const postSelect =
  "id,content,image_url,attachments,created_at,author_id,community_id,is_repost,original_post_id,community:communities(id,name),author:profiles!posts_author_id_fkey(id,first_name,last_name,username,avatar_url,group_name),comments(count),likes:post_likes(count),my_like:post_likes(user_id)";

function selectPosts(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  return supabase.from("posts").select(postSelect, { count: "exact" }).eq("my_like.user_id", userId);
}
type PostRow = QueryData<ReturnType<typeof selectPosts>>[number];

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

async function withReposts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  posts: PostRow[],
  userId: string,
) {
  const originalIds = [...new Set(posts.flatMap((post) => post.original_post_id ? [post.original_post_id] : []))];
  // Fetch each original once through posts RLS. Never recover inaccessible content from a snapshot.
  const [originals, summaries] = await Promise.all([
    originalIds.length ? selectPosts(supabase, userId).in("id", originalIds)
      : Promise.resolve({ data: [] as PostRow[], error: null }),
    posts.length ? supabase.rpc("get_repost_summaries", { p_post_ids: posts.map((post) => post.id) })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (originals.error || summaries.error) throw new Error("Не удалось загрузить репосты.");
  // One Storage request for the current page and its originals; no per-card queries.
  const signed = await signPostAttachments(supabase, [...posts, ...originals.data]);
  const originalsById = new Map(signed.slice(posts.length).map((post) => [post.id, post]));
  const summariesById = new Map(summaries.data.map((summary) => [summary.post_id, summary]));
  return signed.slice(0, posts.length).map((post) => ({
    ...post,
    original: post.original_post_id ? originalsById.get(post.original_post_id) ?? null : null,
    repostCount: summariesById.get(post.id)?.repost_count ?? 0,
    myRepostId: summariesById.get(post.id)?.my_repost_id ?? null,
  }));
}

export async function getPosts(page = 1, authorId?: string, communityId?: string) {
  const user = await requireUser();
  const supabase = await createClient();
  let query = selectPosts(supabase, user.id);
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
  return { posts: await withReposts(supabase, data, user.id), count: count ?? 0 };
}
export type FeedPost = Awaited<ReturnType<typeof getPosts>>["posts"][number];
export type OriginalPost = NonNullable<FeedPost["original"]>;
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
  return data ? (await withReposts(supabase, [data], user.id))[0] : null;
}
