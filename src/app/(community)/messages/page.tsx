import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { requireUser } from "@/lib/auth/session";
import { displayName, formatDate, pageNumber } from "@/lib/format";
import { UUID_PATTERN } from "@/features/posts/validation";
import { getConversations, getConversationMessages } from "@/features/messages/data";
import { MessageForm, RefreshMessagesButton } from "@/features/messages/forms";
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
  // Both queries are scoped to the current user by RLS.
  const [conversations, thread] = await Promise.all([
    getConversations(user.id),
    selectedId ? getConversationMessages(selectedId, page) : Promise.resolve(null),
  ]);
  const selected = conversations.find((conversation) => conversation.id === selectedId);
  if (selectedId && !selected) notFound();
  const participant = selected?.participant;
  const name = participant ? displayName(participant) : "Участник недоступен";
  return (
    <div>
      <header className={styles.heading}>
        <div><h1>Сообщения</h1><p className="muted">Разговоры с людьми твоего колледжа.</p></div>
        <RefreshMessagesButton />
      </header>
      <div className={`${styles.layout} ${selected ? styles.selected : styles.noSelection}`}>
        <aside className={`card ${styles.list}`} aria-label="Диалоги">
          <h2>Твои диалоги</h2>
          {conversations.length ? conversations.map((conversation) => {
            const other = conversation.participant;
            const otherName = other ? displayName(other) : "Участник недоступен";
            return <Link key={conversation.id} href={`/messages?conversation=${conversation.id}`}
              className={`${styles.conversation} ${selected?.id === conversation.id ? styles.active : ""}`}
              aria-current={selected?.id === conversation.id ? "page" : undefined}>
              <Avatar name={otherName} url={other?.avatar_url} size="sm" />
              <div className={styles.summary}><strong>{otherName}</strong>
                <p>{conversation.latest?.body ?? "Пока нет сообщений"}</p>
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
          {selected && thread ? <>
            <Link href="/messages" className={`text-link ${styles.back}`}><ArrowLeft size={16} aria-hidden="true" /> Все диалоги</Link>
            <header className={styles.threadHeader}>
              <Avatar name={name} url={participant?.avatar_url} size="sm" />
              <div><h2>{participant ? <Link href={`/profile/${participant.username}`}>{name}</Link> : name}</h2>
                <p className="muted">Личный диалог · новые сообщения — по кнопке «Обновить»</p>
              </div>
            </header>
            {(thread.hasOlder || page > 1) && <nav className={styles.pagination} aria-label="История сообщений">
              {thread.hasOlder && <Link className="text-link" href={`/messages?conversation=${selected.id}&page=${page + 1}`}>Более ранние</Link>}
              {page > 1 && <Link className="text-link" href={`/messages?conversation=${selected.id}&page=${page - 1}`}>Более новые</Link>}
            </nav>}
            {thread.messages.length ? <ol className={styles.messages}>
              {thread.messages.map((message) => <li id={`message-${message.id}`} key={message.id}
                className={`${styles.message} ${message.sender_id === user.id ? styles.mine : ""}`}>
                <span className="sr-only">{message.sender_id === user.id ? "Ты" : name}: </span>
                <p>{message.body}</p><time dateTime={message.created_at}>{formatDate(message.created_at)}</time>
              </li>)}
            </ol> : <p className={styles.empty}>{page > 1 ? "На этой странице нет сообщений." : "Пока тихо. Напиши первое сообщение."}</p>}
            {participant && <MessageForm key={`${selected.id}-${query.sent ?? ""}`} conversationId={selected.id} />}
          </> : <div className={styles.empty}>
            <MessagesSquare size={38} aria-hidden="true" /><h2>Здесь начинается разговор</h2>
            <p>Выбери диалог слева или напиши участнику из его профиля.</p>
          </div>}
        </section>
      </div>
    </div>
  );
}
