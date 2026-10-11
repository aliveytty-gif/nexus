import "server-only";

import { parseAttachments } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

export async function getConversations() {
  const supabase = await createClient();
  // The RPC is scoped to auth.uid() and returns one summary, not the whole group roster.
  const { data, error } = await supabase.rpc("get_conversation_summaries");
  if (error) throw new Error("Не удалось загрузить диалоги.");
  const paths = [...new Set(data.flatMap((conversation) => conversation.avatar_path ? [conversation.avatar_path] : []))];
  const signed = paths.length ? await supabase.storage.from("message-files").createSignedUrls(paths, 600) : null;
  const urls = new Map(signed?.data?.map((file) => [file.path, file.signedUrl]));
  return data.map((conversation) => ({
    id: conversation.id, kind: conversation.kind, title: conversation.title,
    avatarPath: conversation.avatar_path, avatarUrl: conversation.avatar_path ? urls.get(conversation.avatar_path) ?? null : null,
    myRole: conversation.role, unread: conversation.unread,
    participant: conversation.other_id ? {
      id: conversation.other_id, username: conversation.other_username ?? "",
      first_name: conversation.other_first_name ?? "", last_name: conversation.other_last_name ?? "",
      avatar_url: conversation.other_avatar_url,
    } : null,
    latest: conversation.last_message_id ? {
      id: conversation.last_message_id, body: conversation.last_body,
      attachment_name: conversation.last_attachment_name, created_at: conversation.last_message_at,
      sender_id: conversation.last_sender_id,
    } : null,
    updatedAt: conversation.last_message_at ?? conversation.created_at,
  }));
}

export async function getConversationMembers(conversationId: string, page: number) {
  const supabase = await createClient();
  const pageSize = 30;
  const { data, error, count } = await supabase.from("conversation_members")
    .select("user_id, role, profile:profiles(id, username, first_name, last_name, avatar_url)", { count: "exact" })
    .eq("conversation_id", conversationId).order("joined_at").order("user_id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error("Не удалось загрузить участников.");
  return { members: data, totalMembers: count ?? 0, hasMoreMembers: (count ?? 0) > page * pageSize };
}

export async function getConversationMessages(conversationId: string, page: number) {
  const supabase = await createClient();
  const pageSize = 50;
  const start = (page - 1) * pageSize;
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size, attachments, sender:profiles(id, username, first_name, last_name, avatar_url)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + pageSize);
  if (error) throw new Error("Не удалось загрузить сообщения.");
  const messages = data.slice(0, pageSize).reverse().map((message) => {
    const attachments = parseAttachments(message.attachments);
    // Older deployments used a single file; render it through the same media UI.
    if (!attachments.length && message.attachment_path)
      attachments.push({ path: message.attachment_path, name: message.attachment_name ?? "Файл",
        type: message.attachment_type ?? "", size: message.attachment_size ?? 0 });
    return { ...message, attachments };
  });
  // Sign only paths obtained through message RLS; Storage checks membership again.
  const paths = [...new Set(messages.flatMap((message) => message.attachments.map((file) => file.path)))];
  const signed = paths.length ? await supabase.storage.from("message-files").createSignedUrls(paths, 600) : null;
  const urls = new Map(signed?.data?.map((file) => [file.path, file.signedUrl]));
  return {
    messages: messages.map((message) => ({ ...message, mediaAttachments: message.attachments.map((file) => {
      const signedUrl = urls.get(file.path);
      const url = signedUrl ? new URL(signedUrl) : null;
      if (url) url.searchParams.set("download", file.name);
      return { ...file, url: signedUrl ?? null, downloadUrl: url?.href ?? null };
    }) })),
    hasOlder: data.length > pageSize,
  };
}
