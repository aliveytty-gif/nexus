import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export type ImageBucket = "avatars" | "post-media";
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Only our public buckets are allowed through the Next.js image optimizer. */
export function isStorageImage(url: string): boolean {
  const config = getSupabaseConfig();
  if (!config) return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === config.url && !parsed.search &&
      /^\/storage\/v1\/object\/public\/(avatars|post-media)\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function validateImage(file: File): string | null {
  if (!extensions[file.type]) return "Выберите JPG, PNG или WEBP.";
  if (!file.size || file.size > IMAGE_MAX_BYTES)
    return "Размер фото должен быть от 1 байта до 5 МБ.";
  return null;
}

export function ownedImagePath(url: string, bucket: ImageBucket, userId: string) {
  const config = getSupabaseConfig();
  if (!config) return null;
  const prefix = `${config.url}/storage/v1/object/public/${bucket}/${userId}/`;
  if (!url.startsWith(prefix)) return null;
  const filename = url.slice(prefix.length);
  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(filename)
    ? `${userId}/${filename}`
    : null;
}

// Upload directly to Storage: a 5 MB photo never passes through a Vercel Function.
export async function uploadImage(
  supabase: SupabaseClient<Database>,
  bucket: ImageBucket,
  file: File,
) {
  const validation = validateImage(file);
  if (validation) throw new Error(validation);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Войдите в аккаунт ещё раз.");
  const path = `${user.id}/${crypto.randomUUID()}.${extensions[file.type]}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error("Фото не загрузилось. Проверьте соединение и повторите попытку.");
  return { path, url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl };
}
