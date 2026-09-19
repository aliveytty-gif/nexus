"use client";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/notice";
import { createCommentAction, deleteCommentAction } from "./actions";
import { COMMENT_LIMIT } from "@/features/posts/validation";
export function CommentForm({ postId }: { postId: string }) {
  const [state, action] = useActionState(
    createCommentAction.bind(null, postId),
    {},
  );
  return (
    <form action={action} className="form-stack">
      <div className="field">
        <label className="label" htmlFor="comment-content">
          Твой комментарий
        </label>
        <textarea
          name="content"
          id="comment-content"
          className="input"
          placeholder="Поддержи разговор…"
          required
          maxLength={COMMENT_LIMIT}
          defaultValue={state.content}
          aria-describedby="comment-limit"
        />
        <span id="comment-limit" className="muted small">
          До 2 000 символов
        </span>
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div>
        <SubmitButton pendingText="Отправляем…">
          Отправить комментарий
        </SubmitButton>
      </div>
    </form>
  );
}
export function DeleteCommentButton({
  postId,
  commentId,
}: {
  postId: string;
  commentId: string;
}) {
  const [state, action] = useActionState(
    deleteCommentAction.bind(null, postId, commentId),
    {},
  );
  return (
    <form action={action}>
      <SubmitButton
        className="button button-quiet comment-delete"
        pendingText="Удаляем…"
      >
        Удалить комментарий
      </SubmitButton>
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </form>
  );
}
