import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export type ImageBucket = "avatars" | "post-media";
export const MESSAGE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_ACCEPT = ".mp3,.m4a,.wav";
const audioTypes: Record<string, readonly string[]> = {
  mp3: ["audio/mpeg", "audio/mp3"],
  m4a: ["audio/mp4", "audio/x-m4a"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"],
};
const messageFileTypes: Record<string, readonly string[]> = {
  ...audioTypes,
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  pdf: ["application/pdf"],
  txt: ["text/plain"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  zip: ["application/zip", "application/x-zip-compressed"],
};
export const MESSAGE_FILE_ACCEPT = Object.keys(messageFileTypes).map((extension) => `.${extension}`).join(",");
export type MessageAttachment = { path: string; name: string; type: string; size: number };
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

export function validateMessageFile(file: Pick<File, "name" | "type" | "size">): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!file.name.trim() || file.name.length > 255 || Array.from(file.name).some((character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "/" || character === "\\"))
    return "Имя файла должно быть от 1 до 255 символов без слешей и управляющих символов.";
  if (!Object.hasOwn(messageFileTypes, extension) || !messageFileTypes[extension].includes(file.type))
    return "Выберите фото, MP3, M4A, WAV, PDF, TXT, DOC, DOCX или ZIP с подходящим типом файла.";
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MESSAGE_FILE_MAX_BYTES)
    return "Размер файла должен быть от 1 байта до 10 МБ.";
  return null;
}

export function ownedMessageFilePath(path: string, conversationId: string, userId: string): boolean {
  const prefix = `${conversationId}/${userId}/`;
  const filename = path.slice(prefix.length);
  return path.startsWith(prefix) && filename.length <= 217 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp|pdf|txt|doc|docx|zip|mp3|m4a|wav)$/.test(filename);
}

export function validateAudioFile(file: Pick<File, "name" | "type" | "size">): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!Object.hasOwn(audioTypes, ext) || !audioTypes[ext].includes(file.type))
    return "Выберите MP3, M4A или WAV с подходящим типом файла.";
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > AUDIO_MAX_BYTES)
    return "Размер аудио должен быть от 1 байта до 50 МБ.";
  return validateMessageFile({ name: file.name, type: file.type, size: 1 });
}

export async function uploadAudio(supabase: SupabaseClient<Database>, file: File) {
  const validation = validateAudioFile(file);
  if (validation) throw new Error(validation);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Войдите в аккаунт ещё раз.");
  const ext = file.name.split(".").pop()!.toLowerCase();
  const stem = file.name.slice(0, -(ext.length + 1)).normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 160) || "audio";
  const path = `${user.id}/${crypto.randomUUID()}-${stem}.${ext}`;
  const { error } = await supabase.storage.from("audio").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("Аудио не загрузилось. Проверьте соединение и повторите попытку.");
  return { path };
}

export function formatAttachmentSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} КБ` : `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

// Private uploads never pass through a Server Action or receive a public URL.
export async function uploadMessageFile(
  supabase: SupabaseClient<Database>, conversationId: string, file: File,
): Promise<MessageAttachment> {
  const validation = validateMessageFile(file);
  if (validation) throw new Error(validation);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Войдите в аккаунт ещё раз.");
  const extension = file.name.split(".").pop()!.toLowerCase();
  const stem = file.name.slice(0, -(extension.length + 1)).normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 160) || "file";
  const path = `${conversationId}/${user.id}/${crypto.randomUUID()}-${stem}.${extension}`;
  const { error } = await supabase.storage.from("message-files").upload(path, file, {
    contentType: file.type, upsert: false,
  });
  if (error) throw new Error("Файл не загрузился. Проверьте соединение и повторите попытку.");
  return { path, name: file.name, type: file.type, size: file.size };
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
