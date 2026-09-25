"use client";

import { useActionState, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { SubmitButton } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/notice";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_ACCEPT, uploadImage } from "@/lib/storage";
import { createCommunityAction, membershipAction } from "./actions";

export function CommunityForm() {
  const [state, action, pending] = useActionState(createCommunityAction, {});
  const [photo, setPhoto] = useState<{ path: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  return (
    <form action={action} className="card form-stack" aria-busy={pending || uploading}>
      <div className="field">
        <label className="label" htmlFor="community-name">Название</label>
        <input className="input" id="community-name" name="name" required maxLength={100}
          defaultValue={state.name} placeholder="Название сообщества" />
      </div>
      <div className="field">
        <label className="label" htmlFor="community-description">Описание</label>
        <textarea className="input" id="community-description" name="description" rows={4}
          maxLength={1000} defaultValue={state.description} placeholder="О чём ваше сообщество?" />
      </div>
      <div className="field">
        <label className="label" htmlFor="community-type">Тип</label>
        <select className="input" id="community-type" name="type" defaultValue={state.type ?? "group"}
          aria-describedby="community-type-help">
          <option value="group">Группа</option>
          <option value="channel">Канал</option>
        </select>
        <p className="muted small" id="community-type-help">
          В группе публикуют все участники. В канале — владелец и администраторы.
        </p>
      </div>
      <div className="field">
        <Avatar name="Сообщество" url={photo?.url} size="lg" />
        <label className="label" htmlFor="community-photo">Загрузить фото</label>
        <input className="input" id="community-photo" type="file" accept={IMAGE_ACCEPT}
          disabled={pending || uploading} aria-describedby="community-photo-help"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setUploading(true);
            setUploadError("");
            try {
              const supabase = createClient();
              const uploaded = await uploadImage(supabase, "avatars", file);
              if (photo) await supabase.storage.from("avatars").remove([photo.path]);
              setPhoto(uploaded);
            } catch (error) {
              setUploadError(error instanceof Error ? error.message : "Не удалось загрузить фото.");
            } finally { setUploading(false); }
          }} />
        <input type="hidden" name="avatar_url" value={photo?.url ?? ""} />
        <p className="muted small" id="community-photo-help">
          {uploading ? "Загружаем фото…" : "Необязательно. JPG, PNG или WEBP до 5 МБ."}
        </p>
        {uploadError && <Notice tone="error">{uploadError}</Notice>}
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div><SubmitButton pendingText="Создаём…" disabled={uploading}>Создать сообщество</SubmitButton></div>
    </form>
  );
}

export function MembershipButton({ communityId, isMember }: { communityId: string; isMember: boolean }) {
  const [state, action] = useActionState(membershipAction.bind(null, communityId, !isMember), {});
  return (
    <form action={action} className="form-stack">
      <div><SubmitButton pendingText="Сохраняем…" className={`button button-${isMember ? "secondary" : "primary"}`}>
        {isMember ? "Выйти из сообщества" : "Вступить"}
      </SubmitButton></div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </form>
  );
}
