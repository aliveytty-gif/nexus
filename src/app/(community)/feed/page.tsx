import Link from "next/link";
import { MessageSquare, ArrowUpRight } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { displayName, pageNumber } from "@/lib/format";
import { getProfileById } from "@/features/profiles/data";
import { getPosts, POSTS_PER_PAGE } from "@/features/posts/data";
import { PostComposer } from "@/features/posts/post-composer";
import { PostCard } from "@/features/posts/post-card";
import { Pagination } from "@/components/ui/pagination";
import { Notice } from "@/components/ui/notice";
export const metadata = { title: "Лента" };
export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; published?: string; error?: string }>;
}) {
  const user = await requireUser("/feed");
  const params = await searchParams;
  const page = pageNumber(params.page);
  const [profile, result] = await Promise.all([
    getProfileById(user.id),
    getPosts(page),
  ]);
  if (!profile) throw new Error("Не удалось найти профиль.");
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>
            На связи с колледжем
          </p>
          <h1>Студенческая лента</h1>
          <p>Люди, идеи и всё, что нас объединяет.</p>
        </div>
      </div>
      <div className="feed-layout">
        <div className="stack">
          {params.error === "logout_failed" && (
            <Notice tone="error">
              Не удалось выйти из аккаунта. Проверьте соединение и повторите
              выход.
            </Notice>
          )}
          {Boolean(params.published) && (
            <Notice tone="success">Публикация добавлена в ленту.</Notice>
          )}
          <PostComposer
            key={`${page}-${params.published ?? "initial"}`}
            name={displayName(profile)}
            avatarUrl={profile.avatar_url}
          />
          <div className="section-label">
            <h2>Публикации сообщества</h2>
            <span>Сначала новые</span>
          </div>
          {result.posts.length ? (
            result.posts.map((post) => <PostCard key={post.id} post={post} />)
          ) : (
            <div className="card empty-state">
              <div className="empty-icon">
                <MessageSquare size={26} />
              </div>
              <h2>
                {page === 1 ? "Начни первый разговор" : "Здесь пока пусто"}
              </h2>
              <p>
                {page === 1
                  ? "Поздоровайся, расскажи о себе или предложи идею. Твоя публикация появится здесь."
                  : "На этой странице ещё нет публикаций."}
              </p>
              {page > 1 && (
                <Link href="/feed" className="button button-secondary">
                  В начало ленты
                </Link>
              )}
            </div>
          )}
          <Pagination
            page={page}
            total={result.count}
            perPage={POSTS_PER_PAGE}
            href="/feed"
          />
        </div>
        <aside className="feed-side">
          <section className="card welcome-card">
            <p className="eyebrow" style={{ marginBottom: 14 }}>
              Твой NEXUS
            </p>
            <h2>Начнём со знакомства?</h2>
            <p>
              Добавь специальность, группу и интересы — так другим будет проще
              узнать тебя.
            </p>
            <Link href="/profile/edit" className="text-link small">
              Заполнить профиль{" "}
              <ArrowUpRight size={15} style={{ display: "inline" }} />
            </Link>
          </section>
          <section className="card">
            <h2>Твои интересы</h2>
            {profile.interests.length ? (
              <div className="tags">
                {profile.interests.map((interest) => (
                  <span className="tag" key={interest.id}>
                    #{interest.name}
                  </span>
                ))}
              </div>
            ) : (
              <p>Пока не выбраны. Что тебе близко?</p>
            )}
            <Link
              href="/profile/edit"
              className="text-link small"
              style={{ display: "block", marginTop: 17 }}
            >
              Изменить интересы
            </Link>
          </section>
          <p className="small muted" style={{ padding: "0 6px" }}>
            За каждым постом — человек.
            <br />
            Общайся с уважением.
          </p>
        </aside>
      </div>
    </>
  );
}
