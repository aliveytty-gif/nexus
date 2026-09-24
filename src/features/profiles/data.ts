import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Interest } from "@/types/database";
import type { ProfileWithInterests } from "@/features/profiles/types";

export const getInterests = cache(async (): Promise<Interest[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interests")
    .select("id, slug, name")
    .order("name");
  if (error)
    throw new Error(
      "Не удалось загрузить интересы. Проверьте подключение и миграции Supabase.",
    );
  return data;
});

export const getProfileInterests = cache(
  async (profileId: string): Promise<Interest[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profile_interests")
      .select("interest:interests(id, slug, name)")
      .eq("profile_id", profileId);
    if (error) throw new Error("Не удалось загрузить интересы пользователя.");
    return data
      .map((row) => row.interest)
      .filter((interest): interest is Interest => Boolean(interest))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  },
);

export const getProfileById = cache(
  async (id: string): Promise<ProfileWithInterests | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*, profile_interests(interest:interests(id, slug, name))")
      .eq("id", id)
      .maybeSingle();
    if (error)
      throw new Error(
        "Не удалось загрузить профиль. Проверьте подключение и миграции Supabase.",
      );
    if (!data) return null;
    const { profile_interests, ...profile } = data;
    return {
      ...profile,
      interests: profile_interests
        .map((row) => row.interest)
        .filter((interest): interest is Interest => Boolean(interest))
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    };
  },
);

export const getProfileByUsername = cache(
  async (username: string): Promise<ProfileWithInterests | null> => {
    if (!/^[a-z0-9_]{3,40}$/.test(username)) return null;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*, profile_interests(interest:interests(id, slug, name))")
      .eq("username", username)
      .maybeSingle();
    if (error) throw new Error("Не удалось загрузить профиль.");
    if (!data) return null;
    const { profile_interests, ...profile } = data;
    return {
      ...profile,
      interests: profile_interests
        .map((row) => row.interest)
        .filter((interest): interest is Interest => Boolean(interest))
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    };
  },
);

export type { ProfileWithInterests } from "@/features/profiles/types";
