"use client";

import { useActionState } from "react";
import { Heart } from "lucide-react";
import { setPostLikeAction } from "./actions";

export function LikeButton({ postId, liked, count }: {
  postId: string; liked: boolean; count: number;
}) {
  const [state, action, pending] = useActionState(setPostLikeAction.bind(null, postId, !liked), {});
  return <form action={action}>
    <button type="submit" className="like-button" disabled={pending}
      aria-pressed={liked} aria-label={liked ? "Убрать лайк" : "Поставить лайк"}>
      <Heart size={18} fill={liked ? "currentColor" : "none"} aria-hidden="true" />
      <span>{count}</span>
    </button>
    {state.error && <span role="alert" className="error-text small">{state.error}</span>}
  </form>;
}
