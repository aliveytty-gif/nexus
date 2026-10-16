import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { displayName, pageNumber } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Pagination } from "@/components/ui/pagination";
import { getFriendships } from "@/features/profiles/friendships";
import { FriendControls, type FriendState } from "@/features/profiles/friend-controls";

export const metadata = { title: "Люди и друзья" };
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ page?: string; tab?: string; q?: string | string[] }> }) {
  const user = await requireUser("/people");
  const query = await searchParams;
  const page = pageNumber(query.page);
  const tab = query.tab === "friends" || query.tab === "requests" ? query.tab : "all";
  const search = (Array.isArray(query.q) ? query.q[0] : query.q ?? "").trim().replace(/^@/, "").toLowerCase();
  const validSearch = /^[a-z0-9_]{0,40}$/.test(search);
  const searchParamsFor = (nextTab: string) => {
    const params = new URLSearchParams({ tab: nextTab });
    if (search) params.set("q", search);
    return `/people?${params}`;
  };
  const supabase = await createClient();
  const relationshipsPromise = getFriendships(user.id);
  const { data: blockedIds, error: blockedError } = await supabase.rpc("get_blocked_user_ids");
  if (blockedError) throw new Error("Не удалось загрузить настройки приватности.");
  const blocked = new Set(blockedIds ?? []);
  let peopleQuery = supabase.from("profiles").select("id, username, first_name, last_name, avatar_url", { count: "exact" })
    .neq("id", user.id).order("created_at", { ascending: false }).order("id");
  if (blocked.size) peopleQuery = peopleQuery.not("id", "in", `(${[...blocked].join(",")})`);
  if (search && validSearch) peopleQuery = peopleQuery.ilike("username", `%${search.replaceAll("_", "\\_")}%`);
  peopleQuery = peopleQuery.range((page - 1) * 24, page * 24 - 1);
  const [relationships, profiles] = await Promise.all([
    relationshipsPromise,
    tab === "all" && validSearch ? peopleQuery
      : Promise.resolve({ data: [], count: 0, error: null }),
  ]);
  if (profiles.error) throw new Error("Не удалось загрузить участников.");
  const stateFor = (id: string): FriendState => {
    const row = relationships.find((r) => r.requester_id === id || r.addressee_id === id);
    return !row ? "none" : row.status === "accepted" ? "friends" : row.requester_id === user.id ? "request_sent" : "request_received";
  };
  const people = tab === "all" ? profiles.data ?? [] : relationships
    .filter((r) => tab === "friends" ? r.status === "accepted" : r.status === "pending" && r.addressee_id === user.id)
    .map((r) => r.requester_id === user.id ? r.addressee : r.requester)
    .filter((p) => p !== null && !blocked.has(p.id) && validSearch && p.username.toLowerCase().includes(search));
  const incoming = relationships.filter((r) => r.status === "pending" && r.addressee_id === user.id && !blocked.has(r.requester_id)).length;
  return <>
    <div className="page-heading"><div><h1>Люди и друзья</h1><p>Находи знакомых и принимай приглашения.</p></div></div>
    <nav className="section-tabs" aria-label="Участники">
      {[["all", "Все участники"], ["friends", "Мои друзья"], ["requests", `Входящие заявки (${incoming})`]].map(([key, label]) =>
        <Link key={key} href={searchParamsFor(key)} className={`button button-secondary${tab === key ? " active" : ""}`} aria-current={tab === key ? "page" : undefined}>{label}</Link>)}
    </nav>
    <form action="/people" method="get" className="card form-stack" role="search" style={{ marginBottom: 20 }}>
      <input type="hidden" name="tab" value={tab} />
      <label className="field"><span className="label">Поиск по @username</span>
        <input key={search} className="input" type="search" name="q" defaultValue={search} maxLength={41} placeholder="@username" autoCapitalize="none" spellCheck={false} aria-invalid={!validSearch} aria-describedby={!validSearch ? "people-search-error" : undefined} />
      </label>
      {!validSearch && <p id="people-search-error" className="error-text">Используй латинские буквы, цифры и знак подчёркивания, до 40 символов.</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button className="button button-primary" type="submit">Найти</button>
        {search && <Link href={`/people?tab=${tab}`} className="button button-secondary">Сбросить</Link>}
      </div>
    </form>
    <div className="stack">{people.map((person) => <article className="card person-card" key={person.id}>
      <Link href={`/profile/${person.username}`} className="composer-heading">
        <Avatar name={displayName(person)} url={person.avatar_url} size="sm" />
        <div className="person-name"><h2>{displayName(person)}</h2><p className="muted small">@{person.username}</p></div>
      </Link>
      <FriendControls otherId={person.id} state={stateFor(person.id)} />
    </article>)}</div>
    {!people.length && validSearch && <p className="muted">{search ? "Участники с таким username не найдены." : "Здесь пока никого нет."}</p>}
    {tab === "all" && validSearch && <Pagination page={page} total={profiles.count ?? 0} perPage={24} href={searchParamsFor(tab)} />}
  </>;
}
