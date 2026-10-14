import type { Database } from "@/types/database";

export type DatingProfile = Database["public"]["Tables"]["dating_profiles"]["Row"];
export type DatingPhoto = { path: string; url: string | null };
export type DatingCard = {
  user_id: string; first_name: string; last_name: string; username: string;
  specialty: string; course: number | null; bio: string; age: number | null;
  photos: DatingPhoto[]; interests: { id: string; name: string }[];
};
export type DatingState = { error?: string; success?: string };
export type DatingFilters = { minAge: number | null; maxAge: number | null;
  course: number | null; specialty: string; interestId: string | null };
