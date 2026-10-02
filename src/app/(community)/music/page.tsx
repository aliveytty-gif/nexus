import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { pageNumber } from "@/lib/format";
import { UUID_PATTERN } from "@/features/posts/validation";
import { AudioPlayer } from "@/components/ui/audio-player";
import { AudioUploadForm, PlaylistForm, TrackPlaylistForm } from "@/features/music/forms";
import { getMusicTracks, getPlaylists, getPlaylistTracks, TRACKS_PER_PAGE } from "@/features/music/data";

export const metadata = { title: "Музыка" };

export default async function MusicPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; playlist?: string; page?: string }>;
}) {
  const user = await requireUser("/music");
  const query = await searchParams;
  const playlistId = typeof query.playlist === "string" ? query.playlist : undefined;
  if (playlistId && !UUID_PATTERN.test(playlistId)) notFound();
  const tab = playlistId || query.tab === "playlists" ? "playlists" : query.tab === "all" ? "all" : "mine";
  const page = pageNumber(query.page);
  const [playlists, result] = await Promise.all([
    getPlaylists(),
    playlistId ? getPlaylistTracks(playlistId, page) : tab !== "playlists" ? getMusicTracks(user.id, tab === "mine", page) : null,
  ]);
  const selectedPlaylist = playlists.find((playlist) => playlist.id === playlistId);
  if (playlistId && !selectedPlaylist) notFound();
  const pageHref = (next: number) => `/music?tab=${tab}${playlistId ? `&playlist=${playlistId}` : ""}&page=${next}`;
  const totalPages = Math.max(1, Math.ceil((result?.count ?? 0) / TRACKS_PER_PAGE));

  return <>
    <div className="page-heading"><div><h1>Музыка</h1><p>Твои записи и плейлисты.</p></div></div>
    <nav className="section-tabs" aria-label="Разделы музыки">
      {[["mine", "Мои аудио"], ["all", "Все аудио"], ["playlists", "Плейлисты"]].map(([key, label]) =>
        <Link key={key} className={`button button-secondary${tab === key ? " active" : ""}`}
          href={`/music?tab=${key}`} aria-current={tab === key ? "page" : undefined}>{label}</Link>)}
    </nav>
    <div className="stack">
      {tab === "mine" && <AudioUploadForm />}
      {tab === "playlists" && !selectedPlaylist && <>
        <PlaylistForm />
        {playlists.map((playlist) => <Link key={playlist.id} className="card" href={`/music?tab=playlists&playlist=${playlist.id}`}>
          <h2 style={{ overflowWrap: "anywhere" }}>{playlist.name}</h2>
          <span className="text-link">Открыть плейлист →</span>
        </Link>)}
        {!playlists.length && <p className="muted">Создай первый плейлист, затем добавь треки из «Мои аудио» или «Все аудио».</p>}
      </>}
      {selectedPlaylist && <div className="card">
        <h2 style={{ overflowWrap: "anywhere" }}>{selectedPlaylist.name}</h2>
        <p className="muted">Этот плейлист виден только тебе.</p>
        <Link className="text-link" href="/music?tab=all">Выбрать треки →</Link>
      </div>}
      {result?.tracks.map((track) => <article key={track.id} className="card form-stack">
        <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <h2>{track.title}</h2>
          {track.artist && <p className="muted">{track.artist}</p>}
        </div>
        {track.url ? <AudioPlayer src={track.url} title={track.title} /> :
          <p className="muted">Аудио недоступно. Обнови страницу и попробуй снова.</p>}
        <TrackPlaylistForm trackId={track.id} playlists={playlists} playlistId={playlistId} />
        {!playlistId && !playlists.length && <Link className="text-link" href="/music?tab=playlists">Создать плейлист →</Link>}
      </article>)}
      {result && !result.tracks.length && <div className="card empty-state">
        <h2>{selectedPlaylist ? "В плейлисте пока нет треков" : "Пока нет аудиозаписей"}</h2>
        <p>{selectedPlaylist ? "Добавь аудиозапись из библиотеки." : tab === "mine" ? "Загрузи первый трек с устройства." : "Здесь появятся записи пользователей NEXUS."}</p>
      </div>}
      {result && (page > 1 || totalPages > 1) && <nav className="pagination" aria-label="Страницы аудиозаписей">
        {page > 1 ? <Link className="button button-secondary" href={pageHref(page - 1)}>Назад</Link> : <span />}
        <span className="muted">{page} / {totalPages}</span>
        {page < totalPages ? <Link className="button button-secondary" href={pageHref(page + 1)}>Дальше</Link> : <span />}
      </nav>}
    </div>
  </>;
}
