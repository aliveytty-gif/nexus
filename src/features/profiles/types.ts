import type { Interest, Profile } from "@/types/database";

export type ProfileWithInterests = Profile & { interests: Interest[] };
export type ProfileFields =
  | "first_name"
  | "last_name"
  | "username"
  | "avatar_url"
  | "bio"
  | "specialty"
  | "course"
  | "group_name"
  | "interests";
export type ProfileActionState = {
  error?: string;
  fieldErrors?: Partial<Record<ProfileFields, string>>;
};
