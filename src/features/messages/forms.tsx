"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, RefreshCw, Send } from "lucide-react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { sendMessageAction, startConversationAction } from "./actions";

export function StartConversationButton({ userId }: { userId: string }) {
  const [state, action] = useActionState(startConversationAction.bind(null, userId), {});
  return (
    <form action={action}>
      <SubmitButton pendingText="Открываем…">
        <MessageCircle size={16} aria-hidden="true" /> Написать
      </SubmitButton>
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </form>
  );
}

export function MessageForm({ conversationId }: { conversationId: string }) {
  const [state, action] = useActionState(sendMessageAction.bind(null, conversationId), {});
  return (
    <form action={action} className="form-stack">
      <div className="field">
        <label className="label" htmlFor="message-body">Сообщение</label>
        <textarea id="message-body" name="body" className="input" rows={3}
          placeholder="Начни разговор…" required maxLength={2000}
          defaultValue={state.body} aria-describedby="message-limit" />
        <span id="message-limit" className="muted small">До 2 000 символов</span>
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div><SubmitButton pendingText="Отправляем…">
        <Send size={16} aria-hidden="true" /> Отправить
      </SubmitButton></div>
    </form>
  );
}

export function RefreshMessagesButton() {
  const router = useRouter();
  return (
    <button type="button" className="button button-secondary" onClick={() => router.refresh()}>
      <RefreshCw size={16} aria-hidden="true" /> Обновить
    </button>
  );
}
