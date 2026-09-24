import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function getConversations(userId: string) {
  const supabase = await createClient();
  const { data: memberships, error: membershipError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId);
  if (membershipError) throw new Error("Не удалось загрузить диалоги. Проверьте миграции Supabase.");
  if (!memberships.length) return [];
  const { data, error } = await supabase
    .from("conversations")
    .select("id, created_at, members:conversation_members(user_id, profile:profiles(id, username, first_name, last_name, avatar_url)), messages(body, created_at)")
    .in("id", memberships.map((member) => member.conversation_id))
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" });
  if (error) throw new Error("Не удалось загрузить диалоги.");
  return data.map((conversation) => ({
    id: conversation.id,
    participant: conversation.members.find((member) => member.user_id !== userId)?.profile ?? null,
    latest: conversation.messages[0] ?? null,
    updatedAt: conversation.messages[0]?.created_at ?? conversation.created_at,
  })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversationMessages(conversationId: string, page: number) {
  const supabase = await createClient();
  const pageSize = 50;
  const start = (page - 1) * pageSize;
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + pageSize);
  if (error) throw new Error("Не удалось загрузить сообщения.");
  return { messages: data.slice(0, pageSize).reverse(), hasOlder: data.length > pageSize };
}
