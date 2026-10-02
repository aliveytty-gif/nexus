import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const TRACKS_PER_PAGE = 20;
type AudioTrack = Database["public"]["Tables"]["audio_tracks"]["Row"];

async function withPlaybackUrls(tracks: AudioTrack[]) {
  if (!tracks.length) return [];
  const supabase = await createClient();
  const { data } = await supabase.storage.from("audio")
    .createSignedUrls(tracks.map((track) => track.file_path), 3600);
  const urls = new Map(data?.map((item) => [item.path, item.signedUrl]));
  return tracks.map((track) => ({ ...track, url: urls.get(track.file_path) || null }));
}

export async function getMusicTracks(userId: string, onlyMine: boolean, page: number) {
  const supabase = await createClient();
  let query = supabase.from("audio_tracks").select("*", { count: "exact" });
  if (onlyMine) query = query.eq("owner_id", userId);
  const { data, count, error } = await query
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * TRACKS_PER_PAGE, page * TRACKS_PER_PAGE - 1);
  if (error) throw new Error("Не удалось загрузить аудиозаписи.");
  return { tracks: await withPlaybackUrls(data), count: count ?? 0 };
}

export async function getPlaylists() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("playlists")
    .select("id,name").order("created_at", { ascending: false });
  if (error) throw new Error("Не удалось загрузить плейлисты.");
  return data;
}

export async function getPlaylistTracks(playlistId: string, page: number) {
  const supabase = await createClient();
  const { data, count, error } = await supabase.from("playlist_tracks")
    .select("audio_tracks(*)", { count: "exact" }).eq("playlist_id", playlistId)
    .order("position").order("added_at").order("track_id")
    .range((page - 1) * TRACKS_PER_PAGE, page * TRACKS_PER_PAGE - 1);
  if (error) throw new Error("Не удалось загрузить треки плейлиста.");
  return {
    tracks: await withPlaybackUrls(data.flatMap((row) => row.audio_tracks ? [row.audio_tracks] : [])),
    count: count ?? 0,
  };
}
