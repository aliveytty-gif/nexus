import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function getConversations(userId: string) {
  const supabase = await createClient();
  // RLS returns only conversations belonging to the authenticated session.
  const { data, error } = await supabase
    .from("conversations")
    .select("id, created_at, members:conversation_members(user_id, profile:profiles(id, username, first_name, last_name, avatar_url)), messages(body, attachment_name, created_at)")
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
    .select("id, sender_id, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + pageSize);
  if (error) throw new Error("Не удалось загрузить сообщения.");
  const messages = data.slice(0, pageSize).reverse();
  // Sign only paths obtained through message RLS; Storage checks membership again.
  const paths = messages.flatMap((message) => message.attachment_path ? [message.attachment_path] : []);
  const signed = paths.length ? await supabase.storage.from("message-files").createSignedUrls(paths, 600) : null;
  const urls = new Map(signed?.data?.map((file) => [file.path, file.signedUrl]));
  return {
    messages: messages.map((message) => {
      const signedUrl = urls.get(message.attachment_path);
      const url = signedUrl ? new URL(signedUrl) : null;
      if (url) url.searchParams.set("download", message.attachment_name ?? "file");
      return { ...message, attachmentUrl: signedUrl ?? null, attachmentDownloadUrl: url?.href ?? null };
    }),
    hasOlder: data.length > pageSize,
  };
}
