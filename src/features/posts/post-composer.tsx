"use client";
import { useActionState, useState } from "react";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { SubmitButton } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/notice";
import { createPostAction } from "./actions";
import { POST_LIMIT } from "./validation";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_ACCEPT, uploadImage } from "@/lib/storage";

export function PostComposer({
  name,
  avatarUrl,
  communityId,
}: {
  name: string;
  avatarUrl: string | null;
  communityId?: string;
}) {
  const [state, action, pending] = useActionState(createPostAction, {});
  const [photo, setPhoto] = useState<{ path: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  return (
    <section className="card post-composer" aria-label="Новая публикация">
      <div className="composer-heading">
        <Avatar name={name} url={avatarUrl} />
        <div>
          <h2 style={{ fontSize: ".98rem" }}>Есть чем поделиться?</h2>
          <p>Идея, вопрос или что-то интересное</p>
        </div>
      </div>
      <form action={action} aria-busy={pending || uploading}>
        {communityId && <input type="hidden" name="community_id" value={communityId} />}
        <label className="sr-only" htmlFor="post-content">
          Текст публикации
        </label>
        <textarea
          className="input"
          id="post-content"
          name="content"
          maxLength={POST_LIMIT}
          required
          placeholder="Что происходит в твоём колледже?"
          defaultValue={state.content}
          aria-describedby="post-limit"
        />
        <input type="hidden" name="image_url" value={photo?.url ?? ""} />
        <div className="field" style={{ marginTop: 12 }}>
          <label className="label" htmlFor="post-photo">Прикрепить фото</label>
          <input id="post-photo" className="input" type="file" accept={IMAGE_ACCEPT}
            disabled={pending || uploading} aria-describedby="post-photo-help"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setUploading(true);
              setUploadError("");
              try {
                const supabase = createClient();
                const uploaded = await uploadImage(supabase, "post-media", file);
                if (photo) await supabase.storage.from("post-media").remove([photo.path]);
                setPhoto(uploaded);
              } catch (error) {
                setUploadError(error instanceof Error ? error.message : "Не удалось загрузить фото.");
              } finally { setUploading(false); }
            }} />
          <p id="post-photo-help" className="muted">
            {uploading ? "Загружаем фото…" : "Одна фотография: JPG, PNG или WEBP до 5 МБ."}
          </p>
          {photo && <div>
            <Image src={photo.url} alt="Предпросмотр фотографии" width={600} height={400}
              unoptimized style={{ maxWidth: "100%", height: "auto", maxHeight: 300, objectFit: "contain" }} />
            <button type="button" className="button button-secondary" disabled={pending || uploading}
              onClick={async () => {
                setUploading(true);
                try {
                  await createClient().storage.from("post-media").remove([photo.path]);
                  setPhoto(null);
                } catch { setUploadError("Не удалось удалить фото. Повторите попытку."); }
                finally { setUploading(false); }
              }}>Убрать фото</button>
          </div>}
          {uploadError && <Notice tone="error">{uploadError}</Notice>}
        </div>
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="composer-footer">
          <span id="post-limit">Текст до 5 000 символов</span>
          <SubmitButton pendingText="Публикуем…" disabled={uploading}>
            Опубликовать <ArrowUpRight size={17} />
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
