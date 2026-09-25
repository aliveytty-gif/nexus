import "server-only";
import { createClient } from "@/lib/supabase/server";

export const COMMUNITIES_PER_PAGE = 20;
const communitySelect = "*,community_members(count)";

export async function getCommunities(page = 1) {
  const supabase = await createClient();
  const { data, count, error } = await supabase.from("communities")
    .select(communitySelect, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * COMMUNITIES_PER_PAGE, page * COMMUNITIES_PER_PAGE - 1);
  if (error) throw new Error("Не удалось загрузить сообщества.");
  return { communities: data, count: count ?? 0 };
}

export async function getCommunity(id: string, userId: string) {
  const supabase = await createClient();
  const [community, membership] = await Promise.all([
    supabase.from("communities").select(communitySelect).eq("id", id).maybeSingle(),
    supabase.from("community_members").select("role")
      .eq("community_id", id).eq("user_id", userId).maybeSingle(),
  ]);
  if (community.error || membership.error) throw new Error("Не удалось загрузить сообщество.");
  return { community: community.data, role: membership.data?.role ?? null };
}
