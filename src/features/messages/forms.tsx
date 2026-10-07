"use client";

import { useActionState, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, RefreshCw, Send } from "lucide-react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { AttachmentPicker } from "@/components/ui/attachment-picker";
import { type MessageAttachment } from "@/lib/storage";
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
  const [state, action, pending] = useActionState(sendMessageAction.bind(null, conversationId), {});
  const [uploads, setUploads] = useState<{ attachments: MessageAttachment[]; busy: boolean }>({ attachments: [], busy: false });
  const onChange = useCallback((attachments: MessageAttachment[], busy: boolean) => setUploads({ attachments, busy }), []);
  return (
    <form action={action} className="form-stack" aria-busy={pending || uploads.busy}
      onSubmit={(event) => { if (uploads.busy) event.preventDefault(); }}>
      <div className="field">
        <label className="label" htmlFor="message-body">Сообщение</label>
        <textarea id="message-body" name="body" className="input" rows={3}
          placeholder="Начни разговор…" required={!uploads.attachments.length} disabled={pending} maxLength={2000}
          defaultValue={state.body} aria-describedby="message-limit" />
        <span id="message-limit" className="muted small">До 2 000 символов. Вложения можно отправить без текста.</span>
      </div>
      <input type="hidden" name="attachments" value={JSON.stringify(uploads.attachments)} />
      <AttachmentPicker scope="message" conversationId={conversationId} disabled={pending} onChange={onChange} />
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div><SubmitButton pendingText="Отправляем…" disabled={uploads.busy}>
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
