"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Heart, MessageCircle, UserRound, X } from "lucide-react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { displayName } from "@/lib/format";
import { blockDatingUserAction, openDatingChatAction, reactToDatingAction, reportDatingUserAction } from "./actions";
import type { DatingCard as Card } from "./types";
import styles from "./dating.module.css";

function SafetyControls({ userId }: { userId: string }) {
  const [blockState, blockAction] = useActionState(blockDatingUserAction.bind(null, userId, true), {});
  const [reportState, reportAction] = useActionState(reportDatingUserAction.bind(null, userId), {});
  return <details className={styles.safety}><summary>Скрыть, заблокировать или пожаловаться</summary>
    <p className="muted small">«Пропустить» скрывает анкету из подборки. Блокировка убирает вас из рекомендаций друг друга и запрещает начинать новый личный диалог. Уже существующая переписка сохраняется.</p>
    <form action={blockAction}><SubmitButton className="button button-secondary" pendingText="Блокируем…">Заблокировать</SubmitButton>
      {blockState.error && <Notice tone="error">{blockState.error}</Notice>}</form>
    <form action={reportAction} className="form-stack"><label className="field"><span className="label">Причина жалобы</span>
      <textarea className="input" name="reason" required maxLength={1000} placeholder="Опиши, что произошло" /></label>
      <SubmitButton className="button button-secondary" pendingText="Отправляем…">Пожаловаться</SubmitButton>
      {reportState.error && <Notice tone="error">{reportState.error}</Notice>}
      {reportState.success && <Notice tone="success">{reportState.success}</Notice>}</form>
  </details>;
}

function ChatButton({ userId }: { userId: string }) {
  const [state, action] = useActionState(openDatingChatAction.bind(null, userId), {});
  return <form action={action}><SubmitButton pendingText="Открываем…"><MessageCircle size={18} />Начать общение</SubmitButton>
    {state.error && <Notice tone="error">{state.error}</Notice>}</form>;
}

export function DatingCard({ card, matched = false }: { card: Card; matched?: boolean }) {
  const [state, action, pending] = useActionState(reactToDatingAction.bind(null, card.user_id), {});
  const [photoIndex, setPhotoIndex] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const photo = card.photos[photoIndex];
  return <article className={`card ${styles.card}`} aria-label={`Анкета: ${displayName(card)}`}>
    <div className={styles.hero}>
      {photo?.url && failed !== photo.url ? <Image src={photo.url} alt={`Фото ${displayName(card)}, ${photoIndex + 1}`} width={600} height={640} sizes="(max-width: 600px) 100vw, 480px" unoptimized onError={() => setFailed(photo.url)} /> :
        <div className={styles.placeholder}><UserRound size={48} /><span>{photo ? "Фото недоступно" : "Пока без фотографии"}</span></div>}
      {card.photos.length > 1 && <div className={styles.photoNav} aria-label="Фотографии анкеты">{card.photos.map((item, index) =>
        <button type="button" key={item.path} aria-label={`Фото ${index + 1}`} aria-pressed={photoIndex === index} onClick={() => setPhotoIndex(index)}>{index + 1}</button>)}</div>}
    </div>
    <div className={styles.cardBody}><div><h2>{displayName(card)}{card.age !== null ? `, ${card.age}` : ""}</h2>
      <p className="muted small">{[card.specialty, card.course ? `${card.course} курс` : ""].filter(Boolean).join(" · ") || "Направление не указано"}</p></div>
      {card.bio && <p className={styles.bio}>{card.bio}</p>}
      {!!card.interests.length && <div className={styles.interests}>{card.interests.map((interest) => <span key={interest.id}>{interest.name}</span>)}</div>}
      {matched ? <><p className={styles.matchLabel}><Heart size={17} />У вас взаимная симпатия</p><ChatButton userId={card.user_id} /></> :
        <form action={action} className={styles.reactions} aria-busy={pending}>
          <button type="submit" className="button button-secondary" name="reaction" value="skipped" disabled={pending}><X size={20} />Пропустить</button>
          <button type="submit" className="button button-primary" name="reaction" value="liked" disabled={pending}><Heart size={20} />Интересно</button>
          {state.error && <Notice tone="error">{state.error}</Notice>}
        </form>}
      <Link className="muted small" href={`/profile/${card.username}`}>Профиль в NEXUS</Link>
      <SafetyControls userId={card.user_id} />
    </div>
  </article>;
}
