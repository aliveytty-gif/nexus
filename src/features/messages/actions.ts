"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { UUID_PATTERN } from "@/features/posts/validation";
import { ownedMessageFilePath, parseAttachments, type MessageAttachment } from "@/lib/storage";

export type MessageFormState = { error?: string; body?: string };

export async function startConversationAction(
  otherUserId: string,
): Promise<MessageFormState> {
  const user = await requireUser("/messages");
  if (!UUID_PATTERN.test(otherUserId) || otherUserId === user.id)
    return { error: "Не удалось открыть диалог с этим пользователем." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
    p_other_user_id: otherUserId,
  });
  if (error || !data)
    return { error: "Не удалось открыть диалог. Попробуйте ещё раз." };
  revalidatePath("/messages");
  redirect(`/messages?conversation=${data}`);
}

export async function sendMessageAction(
  conversationId: string,
  _previous: MessageFormState,
  formData: FormData,
): Promise<MessageFormState> {
  const user = await requireUser("/messages");
  const raw = formData.get("body");
  const body = typeof raw === "string" ? raw.trim() : "";
  let attachments: MessageAttachment[];
  try { attachments = parseAttachments(JSON.parse(String(formData.get("attachments") ?? "[]"))); }
  catch (error) { return { body, error: error instanceof Error ? error.message : "Прикрепите файлы заново." }; }
  if ((!body && !attachments.length) || body.length > 2000)
    return { body, error: "Введите сообщение до 2 000 символов или прикрепите файл." };
  if (!UUID_PATTERN.test(conversationId)) return { body, error: "Диалог недоступен." };
  for (const attachment of attachments) {
    if (!ownedMessageFilePath(attachment.path, conversationId, user.id) ||
      attachment.path.split(".").pop() !== attachment.name.split(".").pop()?.toLowerCase())
      return { body, error: "Этот файл нельзя отправить в выбранный диалог." };
  }
  const supabase = await createClient();
  const { data: member, error: memberError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberError || !member)
    return { body, error: "Диалог недоступен." };
  const storedFiles = await Promise.all(attachments.map(async (attachment) => {
    const { data: stored, error } = await supabase.storage.from("message-files").info(attachment.path);
    return !error && stored && (stored.size ?? stored.metadata?.size) === attachment.size &&
      (stored.contentType ?? stored.metadata?.mimetype) === attachment.type;
  }));
  if (storedFiles.some((valid) => !valid))
    return { body, error: "Файл недоступен или его данные изменились. Прикрепите файл заново." };
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId, sender_id: user.id, body,
      attachments,
    })
    .select("id")
    .single();
  if (error)
    return { body, error: "Не удалось отправить сообщение. Попробуйте ещё раз." };
  revalidatePath("/messages");
  redirect(`/messages?conversation=${conversationId}&sent=${data.id}#message-${data.id}`);
}
