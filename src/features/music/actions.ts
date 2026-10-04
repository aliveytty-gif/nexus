"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { UUID_PATTERN } from "@/features/posts/validation";

export type MusicFormState = { error?: string; success?: boolean };

export async function deleteTrackAction(trackId: string): Promise<MusicFormState> {
  const user = await requireUser("/music");
  if (!UUID_PATTERN.test(trackId)) return { error: "Аудиозапись не найдена." };
  const supabase = await createClient();
  const { data: track, error: lookupError } = await supabase.from("audio_tracks")
    .select("file_path").eq("id", trackId).eq("owner_id", user.id).maybeSingle();
  if (lookupError) return { error: "Не удалось найти аудиозапись. Повторите попытку." };
  if (!track) {
    revalidatePath("/music");
    return { success: true };
  }
  if (!track.file_path.startsWith(`${user.id}/`)) return { error: "Не удалось проверить владельца файла." };
  const { error: storageError } = await supabase.storage.from("audio").remove([track.file_path]);
  if (storageError) return { error: "Не удалось удалить файл. Аудиозапись сохранена — попробуйте ещё раз." };
  const { error } = await supabase.from("audio_tracks").delete().eq("id", trackId).eq("owner_id", user.id);
  revalidatePath("/music");
  if (error) return { error: "Файл удалён, но не удалось убрать аудиозапись. Нажмите «Удалить» ещё раз." };
  return { success: true };
}

export async function createTrackAction(
  _previous: MusicFormState, formData: FormData,
): Promise<MusicFormState> {
  const user = await requireUser("/music");
  const title = String(formData.get("title") ?? "").trim();
  const artist = String(formData.get("artist") ?? "").trim();
  const filePath = String(formData.get("file_path") ?? "");
  if (!title || title.length > 200 || artist.length > 200)
    return { error: "Укажите название до 200 символов. Имя исполнителя — до 200 символов." };
  const [owner, filename, extra] = filePath.split("/");
  if (owner !== user.id || extra !== undefined || !filename ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]*\.(mp3|m4a|wav)$/.test(filename))
    return { error: "Загрузите аудиофайл заново." };
  const supabase = await createClient();
  const { error } = await supabase.from("audio_tracks")
    .insert({ owner_id: user.id, title, artist, file_path: filePath });
  if (error) return { error: "Не удалось сохранить аудиозапись. Попробуйте ещё раз." };
  revalidatePath("/music");
  return { success: true };
}

export async function createPlaylistAction(
  _previous: MusicFormState, formData: FormData,
): Promise<MusicFormState> {
  const user = await requireUser("/music");
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 100) return { error: "Название должно содержать от 1 до 100 символов." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("playlists")
    .insert({ owner_id: user.id, name }).select("id").single();
  if (error || !data) return { error: "Не удалось создать плейлист. Попробуйте ещё раз." };
  revalidatePath("/music");
  redirect(`/music?tab=playlists&playlist=${data.id}`);
}

export async function playlistTrackAction(
  trackId: string, remove: boolean, _previous: MusicFormState, formData: FormData,
): Promise<MusicFormState> {
  await requireUser("/music");
  const playlistId = String(formData.get("playlist_id") ?? "");
  if (!UUID_PATTERN.test(trackId) || !UUID_PATTERN.test(playlistId))
    return { error: "Выберите плейлист." };
  const supabase = await createClient();
  if (remove) {
    const { data, error } = await supabase.from("playlist_tracks").delete()
      .eq("playlist_id", playlistId).eq("track_id", trackId).select("track_id");
    if (error || !data.length) return { error: "Не удалось удалить трек из плейлиста." };
  } else {
    const { error } = await supabase.from("playlist_tracks")
      .insert({ playlist_id: playlistId, track_id: trackId });
    if (error && error.code !== "23505") return { error: "Не удалось добавить трек в плейлист." };
  }
  revalidatePath("/music");
  return { success: true };
}
