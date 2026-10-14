import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { UUID_PATTERN } from "@/features/posts/validation";
import type { DatingCard, DatingFilters, DatingPhoto } from "./types";

export const getDatingProfile = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("dating_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Не удалось загрузить настройки знакомств.");
  return data;
});

export async function signDatingPhotos(paths: string[]): Promise<DatingPhoto[]> {
  if (!paths.length) return [];
  const supabase = await createClient();
  const { data } = await supabase.storage.from("dating-photos").createSignedUrls([...new Set(paths)], 60);
  const urls = new Map(data?.map((photo) => [photo.path, photo.signedUrl]));
  return paths.map((path) => ({ path, url: urls.get(path) ?? null }));
}

export async function getDatingCandidates(filters: DatingFilters): Promise<DatingCard[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_dating_candidates", {
    p_min_age: filters.minAge, p_max_age: filters.maxAge, p_course: filters.course,
    p_specialty: filters.specialty || null, p_interest_id: filters.interestId, p_limit: 1,
  });
  if (error) throw new Error("Не удалось загрузить анкеты знакомств.");
  const rows = data ?? [];
  const photos = await signDatingPhotos(rows.flatMap((row) => row.photo_paths));
  const photoMap = new Map(photos.map((photo) => [photo.path, photo]));
  return rows.map((row) => ({ ...row, photos: row.photo_paths.map((path) => photoMap.get(path)!),
    interests: Array.isArray(row.interests) ? row.interests.flatMap((interest) => {
      if (!interest || typeof interest !== "object" || Array.isArray(interest)) return [];
      return typeof interest.id === "string" && typeof interest.name === "string" ? [{ id: interest.id, name: interest.name }] : [];
    }) : [],
  }));
}

export async function getDatingMatches(userId: string): Promise<DatingCard[]> {
  const supabase = await createClient();
  const { data: matches, error } = await supabase.from("dating_matches").select("user_a,user_b")
    .order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error("Не удалось загрузить взаимные симпатии.");
  const ids = (matches ?? []).map((match) => match.user_a === userId ? match.user_b : match.user_a);
  if (!ids.length) return [];
  const [profiles, dating] = await Promise.all([
    supabase.from("profiles").select("id,first_name,last_name,username,specialty,course").in("id", ids),
    supabase.from("dating_profiles").select("user_id,bio,age,photo_paths").in("user_id", ids).eq("enabled", true),
  ]);
  if (profiles.error || dating.error) throw new Error("Не удалось загрузить взаимные симпатии.");
  const photos = await signDatingPhotos((dating.data ?? []).flatMap((row) => row.photo_paths));
  const photoMap = new Map(photos.map((photo) => [photo.path, photo]));
  const profileMap = new Map(profiles.data.map((row) => [row.id, row]));
  const datingMap = new Map(dating.data.map((row) => [row.user_id, row]));
  return ids.flatMap((id) => {
    const profile = profileMap.get(id), row = datingMap.get(id);
    return profile && row ? [{ ...profile, ...row, interests: [], photos: row.photo_paths.map((path) => photoMap.get(path)!) }] : [];
  });
}

export async function getOwnBlocks(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("user_blocks").select("blocked_id").eq("blocker_id", userId);
  if (error) throw new Error("Не удалось загрузить блокировки.");
  const ids = data.map((row) => row.blocked_id);
  if (!ids.length) return [];
  const { data: profiles, error: profileError } = await supabase.from("profiles").select("id,first_name,last_name,username").in("id", ids);
  if (profileError) throw new Error("Не удалось загрузить блокировки.");
  const names = new Map(profiles.map((profile) => [profile.id, profile]));
  return ids.map((id) => ({ id, name: names.has(id) ? `${names.get(id)!.first_name} ${names.get(id)!.last_name}`.trim() || `@${names.get(id)!.username}` : "Участник NEXUS" }));
}

export function parseDatingFilters(query: Record<string, string | string[] | undefined>): DatingFilters {
  const integer = (value: unknown, min: number, max: number) => typeof value === "string" && /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max ? Number(value) : null;
  let minAge = integer(query.min_age, 18, 100), maxAge = integer(query.max_age, 18, 100);
  if (minAge && maxAge && minAge > maxAge) [minAge, maxAge] = [maxAge, minAge];
  return { minAge, maxAge, course: integer(query.course, 1, 6),
    specialty: typeof query.specialty === "string" ? query.specialty.trim().slice(0, 120) : "",
    interestId: typeof query.interest === "string" && UUID_PATTERN.test(query.interest) ? query.interest : null };
}
