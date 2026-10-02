import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function getFriendships(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("friendships")
    .select("id, requester_id, addressee_id, status, requester:profiles!friendships_requester_id_fkey(id, username, first_name, last_name, avatar_url), addressee:profiles!friendships_addressee_id_fkey(id, username, first_name, last_name, avatar_url)")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Не удалось загрузить друзей.");
  return data;
}
