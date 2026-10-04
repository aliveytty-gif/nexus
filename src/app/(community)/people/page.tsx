import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { displayName, pageNumber } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Pagination } from "@/components/ui/pagination";
import { getFriendships } from "@/features/profiles/friendships";
import { FriendControls, type FriendState } from "@/features/profiles/friend-controls";

export const metadata = { title: "Люди и друзья" };
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ page?: string; tab?: string }> }) {
  const user = await requireUser("/people");
  const query = await searchParams;
  const page = pageNumber(query.page);
  const tab = query.tab === "friends" || query.tab === "requests" ? query.tab : "all";
  const supabase = await createClient();
  const [relationships, profiles] = await Promise.all([
    getFriendships(user.id),
    tab === "all" ? supabase.from("profiles").select("id, username, first_name, last_name, avatar_url", { count: "exact" })
      .neq("id", user.id).order("created_at", { ascending: false }).order("id").range((page - 1) * 24, page * 24 - 1)
      : Promise.resolve({ data: [], count: 0, error: null }),
  ]);
  if (profiles.error) throw new Error("Не удалось загрузить участников.");
  const stateFor = (id: string): FriendState => {
    const row = relationships.find((r) => r.requester_id === id || r.addressee_id === id);
    return !row ? "none" : row.status === "accepted" ? "friends" : row.requester_id === user.id ? "request_sent" : "request_received";
  };
  const people = tab === "all" ? profiles.data ?? [] : relationships
    .filter((r) => tab === "friends" ? r.status === "accepted" : r.status === "pending" && r.addressee_id === user.id)
    .map((r) => r.requester_id === user.id ? r.addressee : r.requester).filter((p) => p !== null);
  const incoming = relationships.filter((r) => r.status === "pending" && r.addressee_id === user.id).length;
  return <>
    <div className="page-heading"><div><h1>Люди и друзья</h1><p>Находи знакомых и принимай приглашения.</p></div></div>
    <nav className="section-tabs" aria-label="Участники">
      {[["all", "Все участники"], ["friends", "Мои друзья"], ["requests", `Входящие заявки (${incoming})`]].map(([key, label]) =>
        <Link key={key} href={`/people?tab=${key}`} className={`button button-secondary${tab === key ? " active" : ""}`} aria-current={tab === key ? "page" : undefined}>{label}</Link>)}
    </nav>
    <div className="stack">{people.map((person) => <article className="card person-card" key={person.id}>
      <Link href={`/profile/${person.username}`} className="composer-heading">
        <Avatar name={displayName(person)} url={person.avatar_url} size="sm" />
        <div className="person-name"><h2>{displayName(person)}</h2><p className="muted small">@{person.username}</p></div>
      </Link>
      <FriendControls otherId={person.id} state={stateFor(person.id)} />
    </article>)}</div>
    {!people.length && <p className="muted">Здесь пока никого нет.</p>}
    {tab === "all" && <Pagination page={page} total={profiles.count ?? 0} perPage={24} href="/people" />}
  </>;
}
