import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getInterests } from "@/features/profiles/data";
import { Notice } from "@/components/ui/notice";
import { DatingCard } from "@/features/dating/dating-card";
import { DatingSettingsForm, UnblockUser } from "@/features/dating/settings-form";
import { getDatingCandidates, getDatingMatches, getDatingProfile, getOwnBlocks, parseDatingFilters, signDatingPhotos } from "@/features/dating/data";
import styles from "@/features/dating/dating.module.css";

export const metadata = { title: "Знакомства" };

export default async function DatingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser("/dating");
  const query = await searchParams;
  const tab = query.tab === "settings" || query.tab === "matches" ? query.tab : "discover";
  const filters = parseDatingFilters(query);
  const [profile, interests] = await Promise.all([getDatingProfile(user.id), getInterests()]);
  const [cards, matches, blocks, photos] = await Promise.all([
    profile?.enabled && tab === "discover" ? getDatingCandidates(filters) : Promise.resolve([]),
    profile?.enabled && tab !== "settings" ? getDatingMatches(user.id) : Promise.resolve([]),
    tab === "settings" ? getOwnBlocks(user.id) : Promise.resolve([]),
    tab === "settings" ? signDatingPhotos(profile?.photo_paths ?? []) : Promise.resolve([]),
  ]);
  return <>
    <div className="page-heading"><div><h1>Знакомства</h1><p>Найди тех, с кем хочется общаться.</p></div></div>
    <nav className="section-tabs" aria-label="Знакомства">
      {[["discover", "Подборка"], ["matches", "Взаимные симпатии"], ["settings", "Моя анкета и настройки"]].map(([key, label]) =>
        <Link key={key} href={key === "discover" ? "/dating" : `/dating?tab=${key}`} className={`button button-secondary${tab === key ? " active" : ""}`} aria-current={tab === key ? "page" : undefined}>{label}</Link>)}
    </nav>
    {tab === "settings" ? <div className="stack">
      <DatingSettingsForm profile={profile} photos={photos} />
      <section className="card form-stack"><h2>Заблокированные пользователи</h2>
        {blocks.length ? blocks.map((person) => <UnblockUser key={person.id} id={person.id} name={person.name} />) : <p className="muted">Ты пока никого не заблокировал.</p>}
        <p className="muted small">После снятия блокировки анкеты снова могут появляться в подборке, если не были пропущены. Сохранённая переписка остаётся в разделе сообщений.</p>
      </section>
    </div> : !profile?.enabled ? <section className="card form-stack"><h2>Знакомства по твоему желанию</h2>
      <p className="muted">Твой профиль скрыт. Создай отдельную анкету и включи «Показывать мой профиль в знакомствах», чтобы видеть подборку и взаимные симпатии.</p>
      <Link className="button button-primary" href="/dating?tab=settings">Настроить анкету</Link>
    </section> : tab === "matches" ? <div className="stack">
      {query.matched === "1" && <Notice tone="success">У вас взаимная симпатия. Можно начать общение.</Notice>}
      {matches.length ? <div className={styles.matches}>{matches.map((card) => <DatingCard key={card.user_id} card={card} matched />)}</div> :
        <section className="card"><h2>Взаимные симпатии появятся здесь</h2><p className="muted">Отмечай интересных людей в подборке. Когда симпатия взаимна, можно перейти в личный чат.</p></section>}
    </div> : <div className="stack">
      {!!matches.length && <Notice tone="success"><Link href="/dating?tab=matches">У тебя есть взаимные симпатии. Начать общение →</Link></Notice>}
      <details className={`card ${styles.filters}`} open={Boolean(filters.minAge || filters.maxAge || filters.course || filters.specialty || filters.interestId)}><summary>Фильтры подборки</summary>
        <form action="/dating" method="get" className="form-stack">
          <div className="form-grid"><div className="field"><label className="label" htmlFor="dating-min">Возраст от</label><input id="dating-min" className="input" name="min_age" type="number" min={18} max={100} defaultValue={filters.minAge ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="dating-max">До</label><input id="dating-max" className="input" name="max_age" type="number" min={18} max={100} defaultValue={filters.maxAge ?? ""} /></div></div>
          <div className="form-grid"><div className="field"><label className="label" htmlFor="dating-course">Курс</label><select id="dating-course" className="input" name="course" defaultValue={filters.course ?? ""}><option value="">Любой</option>{[1, 2, 3, 4, 5, 6].map((course) => <option key={course} value={course}>{course} курс</option>)}</select></div>
            <div className="field"><label className="label" htmlFor="dating-specialty">Направление</label><input id="dating-specialty" className="input" name="specialty" maxLength={120} defaultValue={filters.specialty} placeholder="Любое направление" /></div></div>
          <div className="field"><label className="label" htmlFor="dating-interest">Интерес</label><select id="dating-interest" className="input" name="interest" defaultValue={filters.interestId ?? ""}><option value="">Любой</option>{interests.map((interest) => <option key={interest.id} value={interest.id}>{interest.name}</option>)}</select></div>
          <div className="row"><button type="submit" className="button button-primary">Применить</button><Link href="/dating" className="button button-quiet">Сбросить</Link></div>
          <p className="muted small">Если выбран возраст, анкеты без указанного возраста не показываются.</p>
        </form>
      </details>
      {cards.length ? cards.map((card) => <div className={styles.discovery} key={card.user_id}><DatingCard card={card} /></div>) :
        <section className="card"><h2>Подборка закончилась</h2><p className="muted">Пока нет новых анкет с такими фильтрами. Попробуй изменить фильтры или зайти позже.</p></section>}
    </div>}
    <p className={`muted small ${styles.photoHelp}`}>Фото не открывается? Обнови страницу.</p>
  </>;
}
