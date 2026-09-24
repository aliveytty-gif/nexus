import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { pageNumber } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Pagination } from "@/components/ui/pagination";
import { getCommunities, COMMUNITIES_PER_PAGE } from "@/features/communities/data";

export const metadata = { title: "Сообщества" };

export default async function CommunitiesPage({ searchParams }: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireUser("/communities");
  const page = pageNumber((await searchParams).page);
  const result = await getCommunities(page);
  return <>
    <div className="page-heading">
      <div><h1>Сообщества</h1><p>Группы и каналы твоего колледжа.</p></div>
      <Link className="button button-primary" href="/communities/new">Создать сообщество</Link>
    </div>
    <div className="stack">
      {result.communities.map((community) => <article key={community.id} className="card">
        <Link href={`/communities/${community.id}`} className="composer-heading">
          <Avatar name={community.name} url={community.avatar_url} />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ overflowWrap: "anywhere" }}>{community.name}</h2>
            <p>{community.type === "channel" ? "Канал" : "Группа"} · Участников: {community.community_members[0]?.count ?? 0}</p>
          </div>
        </Link>
        {community.description && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{community.description}</p>}
        <Link href={`/communities/${community.id}`} className="text-link">Открыть сообщество →</Link>
      </article>)}
      {!result.communities.length && <div className="card empty-state">
        <h2>Здесь пока нет сообществ</h2><p>Создай группу или канал и собери своих.</p>
      </div>}
      <Pagination page={page} total={result.count} perPage={COMMUNITIES_PER_PAGE} href="/communities" />
    </div>
  </>;
}
