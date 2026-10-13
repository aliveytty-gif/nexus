"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { Repeat2 } from "lucide-react";
import { createRepostAction, type RepostFormState } from "./actions";

export function RepostButton({ postId, count, existingId, disabled = false }: {
  postId: string; count: number; existingId: string | null; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [state, action, pending] = useActionState<RepostFormState, FormData>(createRepostAction.bind(null, postId), {});
  const formId = useId();
  const commentId = useId();

  if (existingId) return <Link href={`/posts/${existingId}`} className="repost-existing">
    <Repeat2 size={18} aria-hidden="true" />Ваш репост · {count}
  </Link>;

  return <div className="repost-control">
    <button type="button" className="repost-button" disabled={disabled || pending}
      aria-expanded={open} aria-controls={open ? formId : undefined}
      title={disabled ? "Публикация недоступна" : undefined}
      onClick={() => setOpen(!open)}>
      <Repeat2 size={18} aria-hidden="true" />Репост · {count}
    </button>
    {open && <form id={formId} action={action} className="repost-form" aria-busy={pending}>
      <label className="label" htmlFor={commentId}>Комментарий к репосту <span className="muted">(необязательно)</span></label>
      <textarea id={commentId} name="comment" className="input" rows={3} maxLength={5000}
        value={comment} onChange={(event) => setComment(event.target.value)} disabled={pending}
        placeholder="Добавьте несколько слов…" />
      {state.error && <p role="alert" className="error-text">{state.error}</p>}
      <div className="repost-actions">
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending ? "Публикуем…" : "Поделиться"}
        </button>
        <button type="button" className="button button-secondary" disabled={pending} onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </form>}
  </div>;
}
