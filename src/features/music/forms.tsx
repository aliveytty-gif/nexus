"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Music2, Trash2, Upload } from "lucide-react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { createClient } from "@/lib/supabase/client";
import { AUDIO_ACCEPT, formatAttachmentSize, uploadAudio, validateAudioFile } from "@/lib/storage";
import { createTrackAction, createPlaylistAction, deleteTrackAction, playlistTrackAction, type MusicFormState } from "./actions";

export function AudioUploadForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, action, pending] = useActionState(async (_previous: MusicFormState, formData: FormData) => {
    if (!file) return { error: "Выберите аудиофайл." };
    const validation = validateAudioFile(file);
    if (validation) return { error: validation };
    const supabase = createClient();
    try {
      const uploaded = await uploadAudio(supabase, file);
      const title = String(formData.get("title") ?? "").trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 200);
      const metadata = new FormData();
      metadata.set("title", title);
      metadata.set("artist", String(formData.get("artist") ?? ""));
      metadata.set("file_path", uploaded.path);
      const result = await createTrackAction({}, metadata);
      if (!result.success) {
        await supabase.storage.from("audio").remove([uploaded.path]);
        return result;
      }
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      router.push("/music");
      router.refresh();
      return { success: true };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Не удалось загрузить аудио. Попробуйте ещё раз." };
    }
  }, {});

  return <form action={action} className="card form-stack" aria-busy={pending}>
    <h2>Загрузить аудио</h2>
    <div className="field">
      <label className="file-picker" htmlFor="audio-file">
        <span className="file-picker-icon"><Upload size={24} aria-hidden="true" /></span>
        <span className="file-picker-copy"><strong>{file ? "Заменить аудио" : "Выбрать аудио"}</strong>
          <span className="muted small">MP3, M4A или WAV · до 50 МБ</span></span>
      <input ref={fileInput} id="audio-file" type="file" accept={AUDIO_ACCEPT}
        required disabled={pending} aria-label="Выбрать аудио" aria-describedby="audio-file-help"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      {file && <div className="file-selection"><Music2 size={24} aria-hidden="true" />
        <div className="file-selection-info"><strong>{file.name}</strong><p className="muted small">{formatAttachmentSize(file.size)}</p></div>
      </div>}
      <p id="audio-file-help" className="muted small">Аудиозапись смогут слушать пользователи NEXUS.</p>
    </div>
    <div className="field">
      <label className="label" htmlFor="audio-title">Название</label>
      <input className="input" id="audio-title" name="title" maxLength={200} disabled={pending}
        placeholder={file ? file.name.replace(/\.[^.]+$/, "") : "Если не указать — используем имя файла"} />
    </div>
    <div className="field">
      <label className="label" htmlFor="audio-artist">Исполнитель</label>
      <input className="input" id="audio-artist" name="artist" maxLength={200} disabled={pending} placeholder="Необязательно" />
    </div>
    {state.error && <Notice tone="error">{state.error}</Notice>}
    {state.success && <Notice tone="success">Аудиозапись добавлена.</Notice>}
    <div><SubmitButton pendingText="Загружаем…" disabled={!file}>Загрузить аудио</SubmitButton></div>
  </form>;
}

export function DeleteTrackForm({ trackId, title }: { trackId: string; title: string }) {
  const [confirm, setConfirm] = useState(false);
  const [state, action, pending] = useActionState(deleteTrackAction.bind(null, trackId), {});
  if (!confirm) return <div><button type="button" className="button button-quiet" onClick={() => setConfirm(true)}>
    <Trash2 size={16} aria-hidden="true" /> Удалить аудио
  </button></div>;
  return <form action={action} className="form-stack" aria-busy={pending}>
    <p className="muted small">Удалить «{title}»? Файл исчезнет из библиотеки и всех плейлистов. Восстановить его можно только повторной загрузкой.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <SubmitButton className="button button-danger" pendingText="Удаляем…">Удалить навсегда</SubmitButton>
      <button type="button" className="button button-secondary" disabled={pending} onClick={() => setConfirm(false)}>Отмена</button>
    </div>
    {state.error && <Notice tone="error">{state.error}</Notice>}
  </form>;
}

export function PlaylistForm() {
  const [state, action] = useActionState(createPlaylistAction, {});
  return <form action={action} className="card form-stack">
    <h2>Создать плейлист</h2>
    <div className="field">
      <label className="label" htmlFor="playlist-name">Название плейлиста</label>
      <input className="input" id="playlist-name" name="name" required maxLength={100} placeholder="Мой плейлист" />
    </div>
    {state.error && <Notice tone="error">{state.error}</Notice>}
    <div><SubmitButton pendingText="Создаём…">Создать плейлист</SubmitButton></div>
  </form>;
}

export function TrackPlaylistForm({ trackId, playlists, playlistId }: {
  trackId: string; playlists: { id: string; name: string }[]; playlistId?: string;
}) {
  const [state, action] = useActionState(playlistTrackAction.bind(null, trackId, !!playlistId), {});
  if (!playlistId && !playlists.length) return null;
  return <form action={action} className="form-stack">
    {playlistId ? <input type="hidden" name="playlist_id" value={playlistId} /> : <div className="field">
      <label className="label" htmlFor={`playlist-${trackId}`}>Плейлист</label>
      <select id={`playlist-${trackId}`} className="input" name="playlist_id" required defaultValue="">
        <option value="" disabled>Выберите плейлист</option>
        {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
      </select>
    </div>}
    <div><SubmitButton className="button button-secondary" pendingText="Сохраняем…">
      {playlistId ? "Удалить из плейлиста" : "Добавить в плейлист"}
    </SubmitButton></div>
    {state.error && <Notice tone="error">{state.error}</Notice>}
    {state.success && !playlistId && <Notice tone="success">Трек в плейлисте.</Notice>}
  </form>;
}
