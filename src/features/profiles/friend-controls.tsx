"use client";
import { useActionState } from "react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { changeFriendship } from "./friend-actions";

export type FriendState = "none" | "request_sent" | "request_received" | "friends";
function FriendAction({ otherId, intent, label }: { otherId: string; intent: "request" | "accept" | "remove"; label: string }) {
  const [state, action] = useActionState(changeFriendship.bind(null, otherId, intent), {});
  return <form action={action}><SubmitButton className="button button-secondary">{label}</SubmitButton>
    {state.error && <Notice tone="error">{state.error}</Notice>}</form>;
}
export function FriendControls({ otherId, state }: { otherId: string; state: FriendState }) {
  return <div className="friend-controls">
    {state === "none" && <FriendAction otherId={otherId} intent="request" label="Добавить в друзья" />}
    {state === "request_sent" && <><span className="muted small">Заявка отправлена</span>
      <FriendAction otherId={otherId} intent="remove" label="Отменить заявку" /></>}
    {state === "request_received" && <>
      <FriendAction otherId={otherId} intent="accept" label="Принять" />
      <FriendAction otherId={otherId} intent="remove" label="Отклонить" /></>}
    {state === "friends" && <><span className="muted small">В друзьях</span>
      <FriendAction otherId={otherId} intent="remove" label="Удалить из друзей" /></>}
  </div>;
}
