"use client";
import { useActionState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { SubmitButton } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/notice";
import { createPostAction } from "./actions";
import { POST_LIMIT } from "./validation";

export function PostComposer({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  const [state, action] = useActionState(createPostAction, {});
  return (
    <section className="card post-composer" aria-label="Новая публикация">
      <div className="composer-heading">
        <Avatar name={name} url={avatarUrl} />
        <div>
          <h2 style={{ fontSize: ".98rem" }}>Есть чем поделиться?</h2>
          <p>Идея, вопрос или что-то интересное</p>
        </div>
      </div>
      <form action={action}>
        <label className="sr-only" htmlFor="post-content">
          Текст публикации
        </label>
        <textarea
          className="input"
          id="post-content"
          name="content"
          maxLength={POST_LIMIT}
          required
          placeholder="Что происходит в твоём колледже?"
          defaultValue={state.content}
          aria-describedby="post-limit"
        />
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="composer-footer">
          <span id="post-limit">Текст до 5 000 символов</span>
          <SubmitButton pendingText="Публикуем…">
            Опубликовать <ArrowUpRight size={17} />
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
