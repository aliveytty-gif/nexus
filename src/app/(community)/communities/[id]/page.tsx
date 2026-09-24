import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { displayName, pageNumber } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { getCommunity } from "@/features/communities/data";
import { MembershipButton } from "@/features/communities/forms";
import { getProfileById } from "@/features/profiles/data";
import { getPosts, POSTS_PER_PAGE } from "@/features/posts/data";
import { PostComposer } from "@/features/posts/post-composer";
import { PostCard } from "@/features/posts/post-card";
import { UUID_PATTERN } from "@/features/posts/validation";

export const metadata = { title: "Сообщество" };

export default async function CommunityPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; published?: string }>;
}) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const user = await requireUser(`/communities/${id}`);
  const query = await searchParams;
  const page = pageNumber(query.page);
  const [{ community, role }, result, profile] = await Promise.all([
    getCommunity(id, user.id), getPosts(page, undefined, id), getProfileById(user.id),
  ]);
  if (!community) notFound();
  const canPublish = role === "owner" || role === "admin" || (community.type === "group" && role === "member");
  return <div className="stack">
    <Link href="/communities" className="back-link">← Сообщества</Link>
    <section className="card">
      <div className="composer-heading">
        <Avatar name={community.name} url={community.avatar_url} size="lg" />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ overflowWrap: "anywhere" }}>{community.name}</h1>
          <p>{community.type === "channel" ? "Канал" : "Группа"} · Участников: {community.community_members[0]?.count ?? 0}</p>
        </div>
      </div>
      {community.description && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{community.description}</p>}
      {role === "owner" ? <p className="tag">Вы владелец сообщества</p> :
        <MembershipButton key={`${id}-${role ?? "guest"}`} communityId={id} isMember={Boolean(role)} />}
    </section>
    {query.published && <Notice tone="success">Публикация добавлена в сообщество.</Notice>}
    {canPublish && profile ? <>
      <h2>Создать публикацию</h2>
      <PostComposer key={`${id}-${query.published ?? "initial"}`} communityId={id}
        name={displayName(profile)} avatarUrl={profile.avatar_url} />
    </> : <p className="muted">{community.type === "channel"
      ? "Публикации этого канала создают владелец и администраторы."
      : "Вступи в группу, чтобы создавать публикации."}</p>}
    <div className="section-label"><h2>Публикации</h2><span>Сначала новые</span></div>
    {result.posts.map((post) => <PostCard key={post.id} post={post} />)}
    {!result.posts.length && <div className="card empty-state"><h2>Публикаций пока нет</h2></div>}
    <Pagination page={page} total={result.count} perPage={POSTS_PER_PAGE} href={`/communities/${id}`} />
  </div>;
}
