"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImagePlus, MessageCircle, RefreshCw, Send, Users, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { AttachmentPicker } from "@/components/ui/attachment-picker";
import { IMAGE_ACCEPT, uploadAttachment, validateImage, type MessageAttachment } from "@/lib/storage";
import { createGroupAction, leaveGroupAction, manageGroupMemberAction, markConversationReadAction, searchGroupPeopleAction,
  sendMessageAction, startConversationAction, updateGroupAction, type GroupFormState, type GroupPerson } from "./actions";
import styles from "./messages.module.css";

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


type GroupRole = "creator" | "admin" | "member";
type GroupMember = { user_id: string; role: GroupRole; profile: GroupPerson | null };
const roleNames: Record<GroupRole, string> = { creator: "Создатель", admin: "Администратор", member: "Участник" };
function personName(person: GroupPerson) { return `${person.first_name} ${person.last_name}`.trim() || person.username; }

function GroupPeopleSearch({ disabled = false, renderPerson }: {
  disabled?: boolean; renderPerson: (person: GroupPerson) => ReactNode;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<GroupPerson[]>([]);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (query.trim().length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      void searchGroupPeopleAction(query.trim()).then((result) => {
        if (!active) return;
        setPeople(result.people);
        setError(result.error ?? "");
        setSearching(false);
      }).catch(() => {
        if (!active) return;
        setError("Не удалось найти пользователей. Попробуйте ещё раз.");
        setSearching(false);
      });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  return <div className={styles.groupSearch}>
    <label className="label" htmlFor={id}>Найти участника</label>
    <input id={id} className="input" type="search" value={query} disabled={disabled}
      placeholder="Имя или @username" maxLength={100} autoComplete="off" aria-describedby={`${id}-help`}
      onChange={(event) => {
        const value = event.target.value;
        setQuery(value); setPeople([]); setError(""); setSearching(value.trim().length >= 2);
      }} />
    <p id={`${id}-help`} className="muted small">Введите минимум 2 символа. Уточните имя, если нужного человека нет в результатах.</p>
    {searching && <p className="muted small" role="status">Ищем…</p>}
    {error && <Notice tone="error">{error}</Notice>}
    {!searching && !error && query.trim().length >= 2 && !people.length && <p className="muted small" role="status">Никого не найдено.</p>}
    {!!people.length && <ul className={styles.groupPeople} aria-label="Результаты поиска">{people.map((person) =>
      <li key={person.id} className={styles.groupPerson}>
        <Avatar name={personName(person)} url={person.avatar_url} size="sm" />
        <div className={styles.groupPersonName}><strong>{personName(person)}</strong><span className="muted small">@{person.username}</span></div>
        {renderPerson(person)}
      </li>)}</ul>}
  </div>;
}

export function GroupCreateForm() {
  const [state, action, pending] = useActionState(createGroupAction, {});
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<GroupPerson[]>([]);
  return <form action={action} className="form-stack" aria-busy={pending}>
    <div className="field">
      <label className="label" htmlFor="new-group-title">Название беседы</label>
      <input className="input" id="new-group-title" name="title" required maxLength={100}
        value={title} onChange={(event) => setTitle(event.target.value)} disabled={pending} placeholder="Например, наша группа" />
    </div>
    <GroupPeopleSearch disabled={pending} renderPerson={(person) => <label className={styles.groupSelect}>
      <input type="checkbox" checked={selected.some((item) => item.id === person.id)} disabled={pending}
        aria-label={`Добавить ${personName(person)} в беседу`}
        onChange={(event) => setSelected((current) => event.target.checked
          ? [...current, person] : current.filter((item) => item.id !== person.id))} />
      <span className="small">Выбрать</span>
    </label>} />
    {!!selected.length && <div className={styles.groupSelected} aria-label="Выбранные участники">
      <p className="small">Выбрано: {selected.length}</p>
      <ul>{selected.map((person) => <li key={person.id}>
        <input type="hidden" name="member_id" value={person.id} />
        <span>{personName(person)}</span>
        <button type="button" disabled={pending} onClick={() => setSelected((current) => current.filter((item) => item.id !== person.id))}
          aria-label={`Убрать ${personName(person)} из выбранных`}><X size={15} aria-hidden="true" /></button>
      </li>)}</ul>
    </div>}
    <p className="muted small">Выберите хотя бы одного человека. Остальных можно добавить после создания.</p>
    {state.error && <Notice tone="error">{state.error}</Notice>}
    <div><SubmitButton pendingText="Создаём…" disabled={!selected.length || !title.trim()}><Users size={17} aria-hidden="true" /> Создать беседу</SubmitButton></div>
  </form>;
}

function GroupMemberAction({ conversationId, userId, operation, name }: {
  conversationId: string; userId: string; operation: "add" | "remove" | "promote" | "demote"; name: string;
}) {
  const [state, action, pending] = useActionState(manageGroupMemberAction.bind(null, conversationId, userId, operation), {});
  const label = { add: "Добавить", remove: "Убрать", promote: "Назначить админом", demote: "Снять роль админа" }[operation];
  return <form action={action} className={styles.groupMemberAction} aria-busy={pending}
    onSubmit={(event) => { if (operation === "remove" && !window.confirm(`Убрать ${name} из беседы?`)) event.preventDefault(); }}>
    <SubmitButton className="button button-secondary" pendingText="Сохраняем…" disabled={operation === "add" && !!state.success}>{label}</SubmitButton>
    {state.error && <Notice tone="error">{state.error}</Notice>}
    {state.success && <span className="muted small" role="status">{state.success}</span>}
  </form>;
}

type GroupPhoto = { file: File; preview: string; path?: string; progress: number; status: "uploading" | "ready" | "error" | "removing"; error?: string };
function GroupEditForm({ conversationId, title, avatarPath, avatarUrl }: {
  conversationId: string; title: string; avatarPath: string | null; avatarUrl: string | null;
}) {
  const [name, setName] = useState(title);
  const [photo, setPhoto] = useState<GroupPhoto | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [savedPath, setSavedPath] = useState(avatarPath);
  const previews = useRef(new Set<string>());
  const transfer = useRef<{ controller: AbortController; done: Promise<void>; path?: string } | null>(null);
  const [state, action, pending] = useActionState(async (previous: GroupFormState, data: FormData) => {
    const result = await updateGroupAction(conversationId, previous, data);
    if (result.success) setSavedPath(String(data.get("avatar_path") ?? "") || null);
    return result;
  }, {});
  useEffect(() => {
    const urls = previews.current;
    return () => { transfer.current?.controller.abort(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, []);
  function start(file: File, preview: string) {
    const controller = new AbortController();
    const current = { controller, done: Promise.resolve(), path: undefined as string | undefined };
    transfer.current = current;
    setPhoto({ file, preview, progress: 0, status: "uploading" });
    current.done = (async () => {
      try {
        const attachment = await uploadAttachment(createClient(), "message", conversationId, file, {
          signal: controller.signal,
          onPath: (path) => { current.path = path; },
          onProgress: (progress) => setPhoto((item) => item ? { ...item, progress } : item),
        });
        if (!controller.signal.aborted) setPhoto({ file, preview, path: attachment.path, progress: 100, status: "ready" });
      } catch (cause) {
        if (!controller.signal.aborted) setPhoto({ file, preview, progress: 0, status: "error",
          error: cause instanceof Error ? cause.message : "Фото не загрузилось. Повторите попытку." });
      }
    })();
  }
  async function remove(retry = false) {
    if (!photo) return;
    setPhoto({ ...photo, status: "removing", error: undefined });
    const current = transfer.current;
    current?.controller.abort();
    await current?.done;
    try {
      const path = photo.path ?? current?.path;
      if (path && path !== savedPath) {
        const { error: removeError } = await createClient().storage.from("message-files").remove([path]);
        if (removeError) throw removeError;
      }
      transfer.current = null;
      if (retry) { start(photo.file, photo.preview); return; }
      URL.revokeObjectURL(photo.preview); previews.current.delete(photo.preview); setPhoto(null);
    } catch {
      setPhoto({ ...photo, status: "error", error: "Не удалось убрать фото. Попробуйте ещё раз." });
    }
  }
  const photoPending = photo?.status === "uploading" || photo?.status === "removing";
  const unsavedPhoto = !!photo && photo.path !== savedPath;
  return <form action={action} className="form-stack" aria-busy={pending || photoPending}
    onSubmit={(event) => { if (photo && photo.status !== "ready") event.preventDefault(); }}>
    <div className="field">
      <label className="label" htmlFor="group-title">Название беседы</label>
      <input className="input" id="group-title" name="title" required maxLength={100} value={name}
        disabled={pending} onChange={(event) => setName(event.target.value)} />
    </div>
    <div className={styles.groupPhoto}>
      {photo?.preview ? /* eslint-disable-next-line @next/next/no-img-element */
        <img src={photo.preview} alt="Новое фото беседы" /> : <Avatar name={name} url={avatarUrl} />}
      <div className={styles.groupPhotoControls}>
        <button type="button" className="button button-secondary" disabled={pending || !!unsavedPhoto}
          onClick={() => input.current?.click()}><ImagePlus size={17} aria-hidden="true" /> Загрузить фото</button>
        <input ref={input} type="file" accept={IMAGE_ACCEPT} hidden disabled={pending || !!unsavedPhoto} aria-label="Выбрать фото беседы"
          onChange={(event) => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (!file) return;
            const validation = validateImage(file); setError(validation ?? "");
            if (validation) return;
            if (photo?.preview) { URL.revokeObjectURL(photo.preview); previews.current.delete(photo.preview); }
            const preview = URL.createObjectURL(file); previews.current.add(preview); start(file, preview);
          }} />
        <p className="muted small">JPG, PNG или WEBP до 5 МБ.</p>
        {photo?.status === "uploading" && <><progress max={100} value={photo.progress} aria-label="Загрузка фото беседы" />
          <span className="muted small" role="status">{photo.progress === 100 ? "Сохраняем файл…" : `Загрузка ${photo.progress}%`}</span></>}
        {photo?.status === "removing" && <span className="muted small" role="status">Убираем фото…</span>}
        {photo?.status === "ready" && unsavedPhoto && <p className="muted small" role="status">Фото загружено. Сохраните изменения.</p>}
        {unsavedPhoto && <div className={styles.groupActions}>
          {photo?.status === "error" && <button type="button" className="button button-secondary" disabled={pending} onClick={() => void remove(true)}>Повторить</button>}
          <button type="button" className="button button-secondary" disabled={pending || photo?.status === "removing"}
            onClick={() => void remove()}>{photo?.status === "uploading" ? "Отменить загрузку" : "Убрать выбранное фото"}</button>
        </div>}
      </div>
    </div>
    <input type="hidden" name="avatar_path" value={photo?.status === "ready" ? photo.path ?? "" : savedPath ?? ""} />
    {(error || photo?.error) && <Notice tone="error">{error || photo?.error}</Notice>}
    {state.error && <Notice tone="error">{state.error}</Notice>}
    {state.success && <Notice tone="success">{state.success}</Notice>}
    <div><SubmitButton disabled={!!photo && photo.status !== "ready"} pendingText="Сохраняем…">Сохранить изменения</SubmitButton></div>
  </form>;
}

function LeaveGroupForm({ conversationId, creator, totalMembers }: { conversationId: string; creator: boolean; totalMembers: number }) {
  const [state, action] = useActionState(leaveGroupAction.bind(null, conversationId), {});
  const explanation = totalMembers === 1 ? "Вы последний участник. При выходе беседа и её сообщения будут удалены."
    : creator ? "Права создателя перейдут администратору, а если администраторов нет — самому раннему участнику."
      : "После выхода переписка станет недоступна. Вернуться можно по добавлению участником с правами управления.";
  return <form action={action} className={styles.groupLeave}
    onSubmit={(event) => { if (!window.confirm(`Выйти из беседы? ${explanation}`)) event.preventDefault(); }}>
    <p className="muted small">{explanation}</p>
    <div><SubmitButton className="button button-secondary" pendingText="Выходим…">Выйти из беседы</SubmitButton></div>
    {state.error && <Notice tone="error">{state.error}</Notice>}
  </form>;
}

export function GroupSettings({ conversationId, title, avatarPath, avatarUrl, myRole, myUserId,
  members, memberPage, hasMoreMembers, totalMembers }: {
  conversationId: string; title: string; avatarPath: string | null; avatarUrl: string | null;
  myRole: GroupRole; myUserId: string; members: GroupMember[]; memberPage: number; hasMoreMembers: boolean; totalMembers: number;
}) {
  const canManage = myRole === "creator" || myRole === "admin";
  return <details className={styles.groupSettings}>
    <summary>Участники и настройки · {totalMembers}</summary>
    <div className={styles.groupSettingsBody}>
      <p className="muted small">Ваша роль: {roleNames[myRole]}</p>
      {myRole === "creator" && <GroupEditForm conversationId={conversationId} title={title} avatarPath={avatarPath} avatarUrl={avatarUrl} />}
      <section aria-label="Участники беседы" className={styles.groupSection}>
        <h3>Участники</h3>
        <ul className={styles.groupPeople}>{members.map((member) => {
          const name = member.profile ? personName(member.profile) : "Участник";
          const isSelf = member.user_id === myUserId;
          const mayRemove = !isSelf && member.role !== "creator" && (myRole === "creator" || (myRole === "admin" && member.role === "member"));
          return <li key={member.user_id} className={styles.groupPerson}>
            <Avatar name={name} url={member.profile?.avatar_url} size="sm" />
            <div className={styles.groupPersonName}>
              {member.profile ? <Link href={`/profile/${member.profile.username}`}><strong>{name}{isSelf ? " · Вы" : ""}</strong></Link> : <strong>{name}</strong>}
              <span className="muted small">{roleNames[member.role]}</span>
            </div>
            <div className={styles.groupActions}>
              {myRole === "creator" && !isSelf && member.role !== "creator" && <GroupMemberAction conversationId={conversationId}
                userId={member.user_id} operation={member.role === "admin" ? "demote" : "promote"} name={name} />}
              {mayRemove && <GroupMemberAction conversationId={conversationId} userId={member.user_id} operation="remove" name={name} />}
            </div>
          </li>;
        })}</ul>
        {(memberPage > 1 || hasMoreMembers) && <nav className={styles.pagination} aria-label="Страницы участников">
          {memberPage > 1 && <Link className="button button-secondary" href={`/messages?conversation=${conversationId}&membersPage=${memberPage - 1}`}>Назад</Link>}
          <span className="muted small">Страница {memberPage}</span>
          {hasMoreMembers && <Link className="button button-secondary" href={`/messages?conversation=${conversationId}&membersPage=${memberPage + 1}`}>Далее</Link>}
        </nav>}
      </section>
      {canManage && <section className={styles.groupSection} aria-label="Добавить участников">
        <h3>Добавить участников</h3>
        <GroupPeopleSearch renderPerson={(person) => members.some((member) => member.user_id === person.id)
          ? <span className="muted small">В беседе</span>
          : <GroupMemberAction conversationId={conversationId} userId={person.id} operation="add" name={personName(person)} />} />
      </section>}
      <LeaveGroupForm conversationId={conversationId} creator={myRole === "creator"} totalMembers={totalMembers} />
    </div>
  </details>;
}


export function MessageReadMarker({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const lastMarked = useRef("");
  useEffect(() => {
    const pair = `${conversationId}/${messageId}`;
    if (lastMarked.current === pair) return;
    lastMarked.current = pair;
    void markConversationReadAction(conversationId, messageId).catch(() => {
      // The next opening can retry; reading a conversation must remain usable.
      if (lastMarked.current === pair) lastMarked.current = "";
    });
  }, [conversationId, messageId]);
  return null;
}
