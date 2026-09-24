"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { UUID_PATTERN } from "@/features/posts/validation";

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
  if (!body || body.length > 2000)
    return { body, error: "Введите сообщение от 1 до 2 000 символов." };
  if (!UUID_PATTERN.test(conversationId))
    return { body, error: "Диалог недоступен." };
  const supabase = await createClient();
  const { data: member, error: memberError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberError || !member)
    return { body, error: "Диалог недоступен." };
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: user.id, body })
    .select("id")
    .single();
  if (error)
    return { body, error: "Не удалось отправить сообщение. Попробуйте ещё раз." };
  revalidatePath("/messages");
  redirect(`/messages?conversation=${conversationId}&sent=${data.id}#message-${data.id}`);
}
