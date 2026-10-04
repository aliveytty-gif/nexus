"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Paperclip, RefreshCw, Send } from "lucide-react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { createClient } from "@/lib/supabase/client";
import { formatAttachmentSize, MESSAGE_FILE_ACCEPT, uploadMessageFile, type MessageAttachment } from "@/lib/storage";
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
  const [attachment, setAttachment] = useState<MessageAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  return (
    <form action={action} className="form-stack" aria-busy={pending || uploading}
      onSubmit={(event) => { if (uploading) event.preventDefault(); }}>
      <div className="field">
        <label className="label" htmlFor="message-body">Сообщение</label>
        <textarea id="message-body" name="body" className="input" rows={3}
          placeholder="Начни разговор…" required={!attachment} disabled={pending} maxLength={2000}
          defaultValue={state.body} aria-describedby="message-limit" />
        <span id="message-limit" className="muted small">До 2 000 символов. Файл можно отправить без текста.</span>
      </div>
      <input type="hidden" name="attachment_path" value={attachment?.path ?? ""} />
      <input type="hidden" name="attachment_name" value={attachment?.name ?? ""} />
      <input type="hidden" name="attachment_type" value={attachment?.type ?? ""} />
      <input type="hidden" name="attachment_size" value={attachment?.size ?? ""} />
      <div className="field">
        <label className="label" htmlFor="message-file"><Paperclip size={16} aria-hidden="true" /> Прикрепить файл</label>
        <input id="message-file" type="file" className="input" accept={MESSAGE_FILE_ACCEPT}
          disabled={pending || uploading || !!attachment} aria-describedby="message-file-help"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setUploading(true);
            setUploadError("");
            try { setAttachment(await uploadMessageFile(createClient(), conversationId, file)); }
            catch (error) { setUploadError(error instanceof Error ? error.message : "Не удалось загрузить файл."); }
            finally { setUploading(false); }
          }} />
        <span id="message-file-help" className="muted small" role="status">
          {uploading ? "Обрабатываем файл…" : "Один файл до 10 МБ: фото, MP3, M4A, WAV, PDF, TXT, DOC, DOCX или ZIP."}
        </span>
        {attachment && <div>
          <p style={{ overflowWrap: "anywhere" }}>{attachment.name} · {formatAttachmentSize(attachment.size)}</p>
          <button type="button" className="button button-secondary" disabled={pending || uploading}
            onClick={async () => {
              setUploading(true);
              setUploadError("");
              try {
                const { error } = await createClient().storage.from("message-files").remove([attachment.path]);
                if (error) throw error;
                setAttachment(null);
              } catch { setUploadError("Не удалось убрать файл. Повторите попытку."); }
              finally { setUploading(false); }
            }}>Убрать файл</button>
        </div>}
        {uploadError && <Notice tone="error">{uploadError}</Notice>}
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div><SubmitButton pendingText="Отправляем…" disabled={uploading}>
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
