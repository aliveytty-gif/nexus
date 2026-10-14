"use client";

import Image from "next/image";
import { ImagePlus } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_ACCEPT, uploadDatingPhoto } from "@/lib/storage";
import { blockDatingUserAction, saveDatingProfileAction } from "./actions";
import type { DatingPhoto, DatingProfile } from "./types";
import styles from "./dating.module.css";

export function DatingSettingsForm({ profile, photos }: { profile: DatingProfile | null; photos: DatingPhoto[] }) {
  const [state, action, pending] = useActionState(saveDatingProfileAction, {});
  const [selected, setSelected] = useState(photos);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const unsaved = useRef(new Set<string>());
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    if (state.success) unsaved.current.clear();
  }, [state]);
  async function choose(files: File[]) {
    if (!files.length) return;
    if (selected.length + files.length > 6) { setError("Можно выбрать до шести фотографий."); return; }
    setError(""); setUploading(true);
    const transfer = new AbortController(); controller.current = transfer;
    try {
      for (const file of files) {
        transfer.signal.throwIfAborted();
        const photo = await uploadDatingPhoto(createClient(), file, transfer.signal);
        unsaved.current.add(photo.path);
        setSelected((previous) => [...previous, photo]);
      }
    } catch (cause) {
      if (!transfer.signal.aborted) setError(cause instanceof Error ? cause.message : "Фото не загрузилось.");
    } finally { setUploading(false); controller.current = null; }
  }
  return <form action={action} className="card form-stack" aria-busy={pending || uploading}>
    <div><h2>Моя анкета</h2><p className="muted">Имя, направление, курс и интересы берутся из профиля только после включения знакомств. Описание и фотографии выбираются здесь отдельно.</p></div>
    <label className={styles.optIn}><input type="checkbox" name="enabled" defaultChecked={profile?.enabled ?? false} disabled={pending} />
      <span>Показывать мой профиль в знакомствах</span></label>
    <p className="muted small">По умолчанию выключено. Отключение скрывает анкету и взаимные симпатии до повторного включения.</p>
    <div className="field"><label className="label" htmlFor="dating-age">Возраст, по желанию</label>
      <input className="input" id="dating-age" name="age" type="number" min={18} max={100} defaultValue={profile?.age ?? ""} disabled={pending} />
      <p className="muted small">Указывать возраст необязательно. Если указываешь — от 18 лет.</p></div>
    <div className="field"><label className="label" htmlFor="dating-bio">Коротко о себе</label>
      <textarea className="input" id="dating-bio" name="bio" maxLength={500} defaultValue={profile?.bio ?? ""} disabled={pending} placeholder="Что тебе интересно, чем хочешь поделиться?" />
      <p className="muted small">До 500 символов. Это описание только для знакомств.</p></div>
    <input type="hidden" name="photo_paths" value={JSON.stringify(selected.map((photo) => photo.path))} />
    <div className="field"><label className="label" htmlFor="dating-photos">Фотографии для знакомств</label>
      <div className={styles.photoList}>{selected.map((photo, index) => <div key={photo.path} className={styles.photoItem}>
        {photo.url ? <Image src={photo.url} width={120} height={150} alt={`Фото анкеты ${index + 1}`} unoptimized /> : <span>Фото недоступно</span>}
        <button className="button button-quiet" type="button" disabled={pending || uploading} aria-label={`Убрать фото ${index + 1}`} onClick={async () => {
          setSelected((previous) => previous.filter((item) => item.path !== photo.path));
          if (unsaved.current.has(photo.path)) {
            unsaved.current.delete(photo.path);
            await createClient().storage.from("dating-photos").remove([photo.path]);
          }
        }}>Убрать</button>
      </div>)}</div>
      <label className="file-picker" htmlFor="dating-photos">
        <span className="file-picker-icon"><ImagePlus size={24} aria-hidden="true" /></span>
        <span className="file-picker-copy"><strong>Добавить фотографии</strong><span className="muted small">Выбери фото с устройства</span></span>
        <input id="dating-photos" type="file" accept={IMAGE_ACCEPT} multiple disabled={pending || uploading || selected.length >= 6}
          onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void choose(files); }} />
      </label>
      <p className="muted small">До шести JPG, PNG или WEBP, каждый до 5 МБ. Первая фотография будет обложкой. Новые фото сжимаются перед загрузкой.</p>
      {uploading && <div className="row"><span role="status">Загружаем фотографии…</span><button className="button button-quiet" type="button" onClick={() => controller.current?.abort()}>Отменить</button></div>}
    </div>
    {error && <Notice tone="error">{error}</Notice>}
    {state.error && <Notice tone="error">{state.error}</Notice>}
    {state.success && <Notice tone="success">{state.success}</Notice>}
    <SubmitButton disabled={uploading}>Сохранить настройки</SubmitButton>
  </form>;
}

export function UnblockUser({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(blockDatingUserAction.bind(null, id, false), {});
  return <form action={action} className={styles.blockRow}><span>{name}</span>
    <SubmitButton className="button button-secondary" pendingText="Снимаем…">Разблокировать</SubmitButton>
    {state.error && <Notice tone="error">{state.error}</Notice>}</form>;
}
