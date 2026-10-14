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
  mp4: ["video/mp4"],
  webm: ["video/webm"],
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
export const MAX_ATTACHMENTS = 10;
export const PHOTO_VIDEO_ACCEPT = ".jpg,.jpeg,.png,.webp,.mp4,.webm";
export type AttachmentScope = "message" | "post";
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

/** Inspect dimensions before decoding; animated WebP stays intact. */
function photoDimensions(header: DataView, type: string): [number, number] | null {
  if (type === "image/png" && header.byteLength >= 24 && header.getUint32(0) === 0x89504e47 &&
    header.getUint32(4) === 0x0d0a1a0a && header.getUint32(12) === 0x49484452)
    return [header.getUint32(16), header.getUint32(20)];
  if (type === "image/webp" && header.byteLength >= 30 && header.getUint32(0) === 0x52494646 &&
    header.getUint32(8) === 0x57454250) {
    const chunk = header.getUint32(12);
    if (chunk === 0x56503858) {
      if (header.getUint8(20) & 2) return null;
      const read24 = (offset: number) => header.getUint8(offset) | header.getUint8(offset + 1) << 8 |
        header.getUint8(offset + 2) << 16;
      return [read24(24) + 1, read24(27) + 1];
    }
    if (chunk === 0x5650384c && header.getUint8(20) === 0x2f) {
      const dimensions = header.getUint32(21, true);
      return [(dimensions & 0x3fff) + 1, ((dimensions >>> 14) & 0x3fff) + 1];
    }
    if (chunk === 0x56503820 && header.getUint8(23) === 0x9d && header.getUint8(24) === 1 && header.getUint8(25) === 0x2a)
      return [header.getUint16(26, true) & 0x3fff, header.getUint16(28, true) & 0x3fff];
  }
  if (type === "image/jpeg" && header.byteLength >= 4 && header.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= header.byteLength && header.getUint8(offset) === 0xff) {
      while (offset < header.byteLength && header.getUint8(offset) === 0xff) offset++;
      if (offset + 3 > header.byteLength) break;
      const marker = header.getUint8(offset++);
      if (marker === 0xda || marker === 0xd9) break;
      const length = header.getUint16(offset);
      if (length < 2 || offset + length > header.byteLength) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 7)
        return [header.getUint16(offset + 5), header.getUint16(offset + 3)];
      offset += length;
    }
  }
  return null;
}

/** Prepare new photos locally; unsupported browsers and larger encodings retain the original. */
export async function compressImage(file: File, maxSide = 1600, signal?: AbortSignal): Promise<File> {
  signal?.throwIfAborted();
  if (!extensions[file.type] || typeof document === "undefined" || typeof createImageBitmap !== "function" ||
    file.size > MESSAGE_FILE_MAX_BYTES || !file.size || !Number.isFinite(maxSide) || maxSide < 1) return file;
  let dimensions: [number, number] | null;
  try {
    dimensions = photoDimensions(new DataView(await file.slice(0, 256 * 1024).arrayBuffer()), file.type);
  } catch {
    signal?.throwIfAborted();
    return file;
  }
  signal?.throwIfAborted();
  if (!dimensions || !dimensions[0] || !dimensions[1] || dimensions[0] * dimensions[1] > 40_000_000 ||
    (file.size <= 256 * 1024 && Math.max(...dimensions) <= maxSide)) return file;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const work = (async () => {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    try {
      if (stopped) return file;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
      if (stopped || !blob || blob.type !== "image/webp" || !blob.size || blob.size >= file.size) return file;
      const stem = file.name.replace(/\.[^.]+$/, "").slice(0, 250);
      return new File([blob], `${stem}.webp`, { type: blob.type, lastModified: file.lastModified });
    } finally {
      bitmap.close();
      canvas.width = canvas.height = 0;
    }
  })();
  const interrupted = new Promise<File>((resolve, reject) => {
    timer = setTimeout(() => { stopped = true; resolve(file); }, 15_000);
    abort = () => { stopped = true; reject(signal?.reason ?? new DOMException("Загрузка отменена", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  try {
    return await Promise.race([work, interrupted]);
  } catch {
    signal?.throwIfAborted();
    return file;
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export function validateMessageFile(file: Pick<File, "name" | "type" | "size">): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!file.name.trim() || file.name.length > 255 || Array.from(file.name).some((character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "/" || character === "\\"))
    return "Имя файла должно быть от 1 до 255 символов без слешей и управляющих символов.";
  if (!Object.hasOwn(messageFileTypes, extension) || !messageFileTypes[extension].includes(file.type))
    return "Выберите фото, MP4, WEBM, MP3, M4A, WAV, PDF, TXT, DOC, DOCX или ZIP с подходящим типом файла.";
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MESSAGE_FILE_MAX_BYTES)
    return "Размер файла должен быть от 1 байта до 10 МБ.";
  return null;
}

export function ownedMessageFilePath(path: string, conversationId: string, userId: string): boolean {
  const prefix = `${conversationId}/${userId}/`;
  const filename = path.slice(prefix.length);
  return path.startsWith(prefix) && filename.length <= 217 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp|pdf|txt|doc|docx|zip|mp3|m4a|wav|mp4|webm)$/.test(filename);
}

export function ownedPostFilePath(path: string, userId: string): boolean {
  return ownedMessageFilePath(`post/${path}`, "post", userId);
}

/** Parse DB or form metadata without accepting arbitrary URLs or extra fields. */
export function parseAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS)
    throw new Error(`Можно прикрепить до ${MAX_ATTACHMENTS} файлов.`);
  const paths = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().join(",") !== "name,path,size,type")
      throw new Error("Прикрепите файлы заново.");
    const data = item as Record<string, unknown>;
    if (typeof data.path !== "string" || data.path.length > 400 || typeof data.name !== "string" ||
      typeof data.type !== "string" || typeof data.size !== "number" || paths.has(data.path))
      throw new Error("Данные вложения недействительны.");
    const attachment = { path: data.path, name: data.name, type: data.type, size: data.size };
    const error = validateMessageFile(attachment);
    if (error) throw new Error(error);
    paths.add(attachment.path);
    return attachment;
  });
}

/** A scoped signed Storage upload reports actual bytes without exposing the account session. */
export async function uploadAttachment(
  supabase: SupabaseClient<Database>, scope: AttachmentScope, conversationId: string | undefined, file: File,
  options: { signal: AbortSignal; onProgress: (percent: number) => void; onPath: (path: string) => void },
): Promise<MessageAttachment> {
  const validation = validateMessageFile(file);
  if (validation) throw new Error(validation);
  options.signal.throwIfAborted();
  file = await compressImage(file, 1600, options.signal);
  options.signal.throwIfAborted();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Войдите в аккаунт ещё раз.");
  options.signal.throwIfAborted();
  const extension = file.name.split(".").pop()!.toLowerCase();
  const stem = file.name.slice(0, -(extension.length + 1)).normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 160) || "file";
  const bucket = scope === "message" ? "message-files" : "post-files";
  const prefix = scope === "message" ? `${conversationId}/${user.id}` : user.id;
  const path = `${prefix}/${crypto.randomUUID()}-${stem}.${extension}`;
  options.onPath(path);
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  options.signal.throwIfAborted();
  if (error || !data) throw new Error("Не удалось начать загрузку. Проверьте соединение и повторите.");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: Error) => {
      options.signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    xhr.open("PUT", data.signedUrl);
    xhr.timeout = 120_000;
    const config = getSupabaseConfig();
    if (config) xhr.setRequestHeader("apikey", config.key);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
    };
    xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error("Файл не загрузился. Повторите попытку."));
    xhr.onerror = () => finish(new Error("Нет соединения. Повторите загрузку."));
    xhr.ontimeout = () => finish(new Error("Загрузка заняла слишком много времени. Повторите попытку."));
    xhr.onabort = () => finish(new DOMException("Загрузка отменена", "AbortError"));
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) { finish(new DOMException("Загрузка отменена", "AbortError")); return; }
    xhr.send(file);
  });
  return { path, name: file.name, type: file.type, size: file.size };
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
  file = await compressImage(file);
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
  file = await compressImage(file, bucket === "avatars" ? 1024 : 1600);
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

/** Dating photos stay private and are uploaded only when explicitly selected. */
export async function uploadDatingPhoto(supabase: SupabaseClient<Database>, file: File, signal?: AbortSignal) {
  const validation = validateImage(file);
  if (validation) throw new Error(validation);
  file = await compressImage(file, 1600, signal);
  signal?.throwIfAborted();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Войдите в аккаунт ещё раз.");
  const path = `${user.id}/${crypto.randomUUID()}-photo.${extensions[file.type]}`;
  const { error } = await supabase.storage.from("dating-photos").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("Фото не загрузилось. Повторите попытку.");
  if (signal?.aborted) {
    await supabase.storage.from("dating-photos").remove([path]);
    signal.throwIfAborted();
  }
  const { data } = await supabase.storage.from("dating-photos").createSignedUrl(path, 60);
  return { path, url: data?.signedUrl ?? null };
}
