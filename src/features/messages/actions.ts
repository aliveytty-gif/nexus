"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { UUID_PATTERN } from "@/features/posts/validation";
import { ownedMessageFilePath, validateMessageFile } from "@/lib/storage";

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
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const path = field("attachment_path");
  const attachment = path ? {
    name: field("attachment_name"), type: field("attachment_type"), size: Number(field("attachment_size")),
  } : null;
  if ((!body && !attachment) || body.length > 2000)
    return { body, error: "Введите сообщение до 2 000 символов или прикрепите файл." };
  if (!UUID_PATTERN.test(conversationId))
    return { body, error: "Диалог недоступен." };
  if (attachment) {
    const validation = validateMessageFile(attachment);
    if (validation) return { body, error: validation };
    if (!ownedMessageFilePath(path, conversationId, user.id) ||
      path.split(".").pop() !== attachment.name.split(".").pop()?.toLowerCase())
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
  if (attachment) {
    const { data: stored, error: storageError } = await supabase.storage.from("message-files").info(path);
    if (storageError || !stored || (stored.size ?? stored.metadata?.size) !== attachment.size ||
      (stored.contentType ?? stored.metadata?.mimetype) !== attachment.type)
      return { body, error: "Файл недоступен или его данные изменились. Прикрепите файл заново." };
  }
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId, sender_id: user.id, body,
      attachment_path: path || null, attachment_name: attachment?.name ?? null,
      attachment_type: attachment?.type ?? null, attachment_size: attachment?.size ?? null,
    })
    .select("id")
    .single();
  if (error)
    return { body, error: "Не удалось отправить сообщение. Попробуйте ещё раз." };
  revalidatePath("/messages");
  redirect(`/messages?conversation=${conversationId}&sent=${data.id}#message-${data.id}`);
}
