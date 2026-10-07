import "server-only";

import { parseAttachments } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

export async function getConversations(userId: string) {
  const supabase = await createClient();
  // RLS returns only conversations belonging to the authenticated session.
  const { data, error } = await supabase
    .from("conversations")
    .select("id, created_at, members:conversation_members(user_id, profile:profiles(id, username, first_name, last_name, avatar_url)), messages(body, attachment_name, attachments, created_at)")
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" });
  if (error) throw new Error("Не удалось загрузить диалоги.");
  return data.map((conversation) => ({
    id: conversation.id,
    participant: conversation.members.find((member) => member.user_id !== userId)?.profile ?? null,
    latest: conversation.messages[0] ? { ...conversation.messages[0],
      attachment_name: parseAttachments(conversation.messages[0].attachments).map((file) => file.name).join(", ") || conversation.messages[0].attachment_name,
    } : null,
    updatedAt: conversation.messages[0]?.created_at ?? conversation.created_at,
  })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversationMessages(conversationId: string, page: number) {
  const supabase = await createClient();
  const pageSize = 50;
  const start = (page - 1) * pageSize;
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size, attachments")
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
