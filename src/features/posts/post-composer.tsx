"use client";
import { useActionState, useCallback, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { SubmitButton } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/notice";
import { createPostAction } from "./actions";
import { POST_LIMIT } from "./validation";
import { AttachmentPicker } from "@/components/ui/attachment-picker";
import type { MessageAttachment } from "@/lib/storage";

export function PostComposer({
  name,
  avatarUrl,
  communityId,
}: {
  name: string;
  avatarUrl: string | null;
  communityId?: string;
}) {
  const [state, action, pending] = useActionState(createPostAction, {});
  const [{ attachments, busy: uploading }, setUploadState] = useState<{
    attachments: MessageAttachment[]; busy: boolean;
  }>({ attachments: [], busy: false });
  const updateAttachments = useCallback((files: MessageAttachment[], busy: boolean) => {
    setUploadState({ attachments: files, busy });
  }, []);
  return (
    <section className="card post-composer" aria-label="Новая публикация">
      <div className="composer-heading">
        <Avatar name={name} url={avatarUrl} />
        <div>
          <h2 style={{ fontSize: ".98rem" }}>Есть чем поделиться?</h2>
          <p>Идея, вопрос или что-то интересное</p>
        </div>
      </div>
      <form action={action} aria-busy={pending || uploading}
        onSubmit={(event) => { if (pending || uploading) event.preventDefault(); }}>
        {communityId && <input type="hidden" name="community_id" value={communityId} />}
        <label className="sr-only" htmlFor="post-content">
          Текст публикации
        </label>
        <textarea
          className="input"
          id="post-content"
          name="content"
          maxLength={POST_LIMIT}
          required={!attachments.length}
          disabled={pending}
          placeholder="Что происходит в твоём колледже?"
          defaultValue={state.content}
          aria-describedby="post-limit"
        />
        <input type="hidden" name="attachments" value={JSON.stringify(attachments)} />
        <AttachmentPicker scope="post" disabled={pending} onChange={updateAttachments} />
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="composer-footer">
          <span id="post-limit">Текст до 5 000 символов</span>
          <SubmitButton pendingText="Публикуем…" disabled={uploading}>
            Опубликовать <ArrowUpRight size={17} />
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
