import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessagesSquare, Plus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { requireUser } from "@/lib/auth/session";
import { displayName, formatDate, pageNumber } from "@/lib/format";
import { MessageAttachment } from "@/features/messages/attachment";
import { UUID_PATTERN } from "@/features/posts/validation";
import { getConversations, getConversationMessages, getConversationMembers } from "@/features/messages/data";
import { MessageForm, RefreshMessagesButton, GroupCreateForm, GroupSettings, MessageReadMarker } from "@/features/messages/forms";
import styles from "@/features/messages/messages.module.css";

export const metadata = { title: "Сообщения" };

export default async function MessagesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("/messages");
  const query = await searchParams;
  const selectedId = typeof query.conversation === "string" ? query.conversation.toLowerCase() : undefined;
  if (selectedId && !UUID_PATTERN.test(selectedId)) notFound();
  const page = pageNumber(query.page);
  const memberPage = pageNumber(query.membersPage);
  const creating = query.new === "group" && !selectedId;
  // Both queries are scoped to the current user by RLS.
  const [conversations, thread, roster] = await Promise.all([
    getConversations(),
    selectedId ? getConversationMessages(selectedId, page) : Promise.resolve(null),
    selectedId ? getConversationMembers(selectedId, memberPage) : Promise.resolve(null),
  ]);
  const selected = conversations.find((conversation) => conversation.id === selectedId);
  if (selectedId && !selected) notFound();
  const participant = selected?.participant;
  const isGroup = selected?.kind === "group";
  const name = isGroup ? selected.title ?? "Беседа" : participant ? displayName(participant) : "Участник недоступен";
  return (
    <div>
      <header className={styles.heading}>
        <div><h1>Сообщения</h1><p className="muted">Разговоры с людьми твоего колледжа.</p></div>
        <div className={styles.groupActions}><Link href="/messages?new=group" className="button button-secondary"><Plus size={16} aria-hidden="true" /> Беседа</Link><RefreshMessagesButton /></div>
      </header>
      <div className={`${styles.layout} ${selected || creating ? styles.selected : styles.noSelection}`}>
        <aside className={`card ${styles.list}`} aria-label="Диалоги">
          <h2>Твои диалоги</h2>
          {conversations.length ? conversations.map((conversation) => {
            const other = conversation.participant;
            const otherName = conversation.kind === "group" ? conversation.title ?? "Беседа" : other ? displayName(other) : "Участник недоступен";
            return <Link key={conversation.id} href={`/messages?conversation=${conversation.id}`}
              className={`${styles.conversation} ${selected?.id === conversation.id ? styles.active : ""}`}
              aria-current={selected?.id === conversation.id ? "page" : undefined}>
              <Avatar name={otherName} url={conversation.kind === "group" ? conversation.avatarUrl : other?.avatar_url} size="sm" />
              <div className={styles.summary}><strong>{otherName}</strong>
                <p>{conversation.latest?.body || conversation.latest?.attachment_name || "Пока нет сообщений"}</p>
              </div>
              <div className={styles.conversationMeta}>
                <time dateTime={conversation.updatedAt}>{new Date(conversation.updatedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</time>
                {conversation.unread && selected?.id !== conversation.id && <span className={styles.unreadBadge} aria-label="Есть непрочитанные сообщения" />}
              </div>
            </Link>;
          }) : <div className={styles.empty}>
            <MessagesSquare size={30} aria-hidden="true" />
            <h2>Первый разговор впереди</h2>
            <p>Открой профиль участника и нажми «Написать».</p>
            <Link href="/feed" className="text-link">Перейти в ленту</Link>
          </div>}
        </aside>
        <section className={`card ${styles.thread}`} aria-label="Переписка">
          {creating ? <>
            <Link href="/messages" className="text-link"><ArrowLeft size={16} aria-hidden="true" /> Все диалоги</Link>
            <GroupCreateForm />
          </> : selected && thread ? <>
            <Link href="/messages" className={`text-link ${styles.back}`}><ArrowLeft size={16} aria-hidden="true" /> Все диалоги</Link>
            <header className={styles.threadHeader}>
              <Avatar name={name} url={isGroup ? selected.avatarUrl : participant?.avatar_url} size="sm" />
              <div><h2>{!isGroup && participant ? <Link href={`/profile/${participant.username}`}>{name}</Link> : name}</h2>
                <p className="muted">{isGroup ? `Беседа · ${roster?.totalMembers ?? 0} участников` : "Личный диалог"} · новые сообщения — по кнопке «Обновить»</p>
              </div>
            </header>
            {isGroup && roster && <GroupSettings key={selected.id} conversationId={selected.id} title={name}
              avatarPath={selected.avatarPath} avatarUrl={selected.avatarUrl} myRole={selected.myRole}
              myUserId={user.id} members={roster.members} memberPage={memberPage}
              totalMembers={roster.totalMembers} hasMoreMembers={roster.hasMoreMembers} />}
            {page === 1 && thread.messages.at(-1) && <MessageReadMarker conversationId={selected.id} messageId={thread.messages.at(-1)!.id} />}
            {(thread.hasOlder || page > 1) && <nav className={styles.pagination} aria-label="История сообщений">
              {thread.hasOlder && <Link className="text-link" href={`/messages?conversation=${selected.id}&page=${page + 1}`}>Более ранние</Link>}
              {page > 1 && <Link className="text-link" href={`/messages?conversation=${selected.id}&page=${page - 1}`}>Более новые</Link>}
            </nav>}
            {thread.messages.length ? <ol className={styles.messages}>
              {thread.messages.map((message, index) => {
                const previous = thread.messages[index - 1];
                const consecutive = previous?.sender_id === message.sender_id &&
                  new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < 300_000;
                const authorName = message.sender_id === user.id ? "Ты" : message.sender ? displayName(message.sender) : "Участник недоступен";
                return <li id={`message-${message.id}`} key={message.id}
                className={`${styles.message} ${message.sender_id === user.id ? styles.mine : ""} ${consecutive ? styles.consecutive : ""}`}>
                {isGroup && !consecutive && <div className={styles.messageAuthor}>
                  {message.sender ? <Link href={`/profile/${message.sender.username}`}>{authorName}</Link> : authorName}
                </div>}
                <span className="sr-only">{authorName}: </span>
                {message.body && <p>{message.body}</p>}
                {message.mediaAttachments.map((file) => <MessageAttachment key={file.path}
                  name={file.name} type={file.type} size={file.size} url={file.url} downloadUrl={file.downloadUrl} />)}
                <time dateTime={message.created_at}>{formatDate(message.created_at)}</time>
              </li>; })}
            </ol> : <p className={styles.empty}>{page > 1 ? "На этой странице нет сообщений." : "Пока тихо. Напиши первое сообщение."}</p>}
            {thread.messages.some((message) => message.mediaAttachments.length) && <p className="muted small">Ссылки на файлы действуют 10 минут. Если ссылка истекла, нажми «Обновить».</p>}
            {(isGroup || participant) && <MessageForm key={`${selected.id}-${query.sent ?? ""}`} conversationId={selected.id} />}
          </> : <div className={styles.empty}>
            <MessagesSquare size={38} aria-hidden="true" /><h2>Здесь начинается разговор</h2>
            <p>Выбери диалог слева или напиши участнику из его профиля.</p>
          </div>}
        </section>
      </div>
    </div>
  );
}
