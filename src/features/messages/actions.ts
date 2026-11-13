"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { UUID_PATTERN } from "@/features/posts/validation";
import { ownedMessageFilePath, parseAttachments, type MessageAttachment } from "@/lib/storage";

export type MessageFormState = { error?: string; messageId?: string; uncertain?: boolean };
export type GroupFormState = { error?: string; success?: string };
export type GroupPerson = {
  id: string; username: string; first_name: string; last_name: string; avatar_url: string | null;
};

export async function searchGroupPeopleAction(query: string): Promise<{ people: GroupPerson[]; error?: string }> {
  const user = await requireUser("/messages");
  // Allow ordinary names/usernames, never interpolate PostgREST filter syntax.
  const term = query.trim().replace(/^@/, "").replace(/[^\p{L}\p{N}_ -]/gu, "").slice(0, 60);
  if (term.length < 2) return { people: [] };
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles")
    .select("id, username, first_name, last_name, avatar_url").neq("id", user.id)
    .or(`username.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
    .order("username").limit(20);
  return error ? { people: [], error: "Не удалось найти участников. Повторите поиск." } : { people: data };
}

export async function createGroupAction(_previous: GroupFormState, formData: FormData): Promise<GroupFormState> {
  await requireUser("/messages");
  const title = String(formData.get("title") ?? "").trim();
  const members = [...new Set(formData.getAll("member_id").map(String))];
  if (!title || title.length > 100) return { error: "Введите название до 100 символов." };
  if (!members.length || members.some((id) => !UUID_PATTERN.test(id)))
    return { error: "Выберите участников беседы." };
  const supabase = await createClient();
  // An unmigrated Preview must not fall back to the old immediate-add RPC behavior.
  const { error: invitationError } = await supabase.rpc("get_group_invitations");
  if (invitationError) return { error: "Приглашения временно недоступны. Попробуйте позже." };
  const { data, error } = await supabase.rpc("create_group_conversation", { p_title: title, p_member_ids: members });
  if (error || !data) return { error: "Не удалось создать беседу. Обновите список участников и повторите." };
  revalidatePath("/messages");
  redirect(`/messages?conversation=${data}`);
}

export async function updateGroupAction(conversationId: string, _previous: GroupFormState, formData: FormData): Promise<GroupFormState> {
  await requireUser("/messages");
  const title = String(formData.get("title") ?? "").trim();
  const avatarPath = String(formData.get("avatar_path") ?? "").trim() || null;
  if (!UUID_PATTERN.test(conversationId) || !title || title.length > 100 || (avatarPath && avatarPath.length > 400))
    return { error: "Проверьте название и фотографию беседы." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_group_conversation", {
    p_conversation_id: conversationId, p_title: title, p_avatar_path: avatarPath,
  });
  if (error) return { error: "Не удалось сохранить. Изменять беседу может её создатель; фотографию загрузите заново." };
  revalidatePath("/messages");
  return { success: "Беседа обновлена." };
}

export async function manageGroupMemberAction(
  conversationId: string, userId: string, operation: "add" | "remove" | "promote" | "demote",
): Promise<GroupFormState> {
  await requireUser("/messages");
  if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(userId) || !["add", "remove", "promote", "demote"].includes(operation))
    return { error: "Участник недоступен." };
  const supabase = await createClient();
  if (operation === "add") {
    const { error: invitationError } = await supabase.rpc("get_group_invitations");
    if (invitationError) return { error: "Приглашения временно недоступны. Попробуйте позже." };
  }
  const { error } = await supabase.rpc("manage_group_member", {
    p_conversation_id: conversationId, p_user_id: userId, p_action: operation,
  });
  if (error) return { error: "Не удалось изменить участника. Проверьте свои права и обновите беседу." };
  revalidatePath("/messages");
  return { success: operation === "add" ? "Приглашение отправлено. Ждём ответа." : "Состав беседы обновлён." };
}

export async function respondToGroupInvitationAction(
  conversationId: string, _previous: GroupFormState, formData: FormData,
): Promise<GroupFormState> {
  const user = await requireUser("/messages");
  const response = formData.get("response");
  if (!UUID_PATTERN.test(conversationId) || (response !== "accept" && response !== "decline"))
    return { error: "Приглашение недоступно." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_group_invitation", {
    p_conversation_id: conversationId, p_accept: response === "accept",
  });
  if (error) return { error: "Не удалось ответить. Обновите приглашения или отклоните недоступное приглашение." };
  revalidatePath("/messages");
  if (response === "accept") {
    const { data: membership, error: membershipError } = await supabase.from("conversation_members")
      .select("user_id").eq("conversation_id", conversationId).eq("user_id", user.id).maybeSingle();
    if (membershipError || !membership) return { error: "Приглашение больше недоступно. Обновите список." };
    redirect(`/messages?conversation=${conversationId}`);
  }
  return { success: "Приглашение отклонено." };
}

export async function leaveGroupAction(conversationId: string): Promise<GroupFormState> {
  await requireUser("/messages");
  if (!UUID_PATTERN.test(conversationId)) return { error: "Беседа недоступна." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_group_conversation", { p_conversation_id: conversationId });
  if (error) return { error: "Не удалось выйти. Обновите беседу и повторите." };
  revalidatePath("/messages");
  redirect("/messages");
}

export async function markConversationReadAction(conversationId: string, messageId: string): Promise<void> {
  await requireUser("/messages");
  if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(messageId)) return;
  const supabase = await createClient();
  await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId, p_message_id: messageId });
}

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
    return { error: error?.message === "User unavailable" ? "Диалог недоступен из-за блокировки пользователя." : "Не удалось открыть диалог. Попробуйте ещё раз." };
  revalidatePath("/messages");
  redirect(`/messages?conversation=${data}`);
}

export async function sendMessageAction(
  conversationId: string,
  nonce: string,
  senderId: string,
  formData: FormData,
): Promise<MessageFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Сессия закончилась. Войдите снова в другой вкладке, чтобы сохранить черновик." };
  if (user.id !== senderId) return { error: "Аккаунт изменился. Войдите в аккаунт, в котором начали сообщение." };
  if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(nonce))
    return { error: "Обновите диалог перед отправкой." };
  const raw = formData.get("body");
  const body = typeof raw === "string" ? raw.trim() : "";
  let attachments: MessageAttachment[];
  try { attachments = parseAttachments(JSON.parse(String(formData.get("attachments") ?? "[]"))); }
  catch (error) { return { error: error instanceof Error ? error.message : "Прикрепите файлы заново." }; }
  if ((!body && !attachments.length) || body.length > 2000)
    return { error: "Введите сообщение до 2 000 символов или прикрепите файл." };
  for (const attachment of attachments) {
    if (!ownedMessageFilePath(attachment.path, conversationId, user.id) ||
      attachment.path.split(".").pop() !== attachment.name.split(".").pop()?.toLowerCase())
      return { error: "Этот файл нельзя отправить в выбранный диалог." };
  }
  const supabase = await createClient();
  const { data, error, status } = await supabase.rpc("send_message", {
    p_conversation_id: conversationId,
    p_client_nonce: nonce,
    p_body: body,
    p_attachments: attachments,
  });
  if (error?.code === "42501") return { error: "Диалог или вложение недоступны." };
  if (error?.code === "23514")
    return { error: "Не удалось сохранить сообщение. Проверьте текст и заново прикрепите недоступные файлы.", uncertain: false };
  if (error?.code === "23505")
    return { error: "Этот черновик уже был отправлен с другим содержимым. Обновите диалог.", uncertain: true };
  if (status === 0 || status === 408 || status >= 500 || (!error && !data))
    return { error: "Не удалось подтвердить отправку. Повторите её, чтобы проверить результат.", uncertain: true };
  if (error || !data)
    return { error: "Не удалось отправить сообщение. Попробуйте ещё раз." };

  revalidatePath("/messages");
  return { messageId: data };
}
