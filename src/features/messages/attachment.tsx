"use client";

import { useRef, useState } from "react";
import { ExternalLink, FileArchive, FileText, X } from "lucide-react";
import { AudioPlayer } from "@/components/ui/audio-player";
import { formatAttachmentSize } from "@/lib/storage";
import styles from "./messages.module.css";

function ImageAttachment({ name, url, onError }: {
  name: string; url: string; onError: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return <>
    <a href={url} className={styles.imagePreview} target="_blank" rel="noopener noreferrer" aria-label={`Увеличить фото: ${name}`}
      onClick={(event) => {
        if (!dialogRef.current?.showModal) return;
        event.preventDefault();
        dialogRef.current.showModal();
      }}>
      {/* Private URLs must not pass through the public image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name} className={styles.mediaImage} loading="lazy" referrerPolicy="no-referrer"
        ref={(image) => {
          // The signed image can fail before React attaches onError.
          if (image?.complete && image.naturalWidth === 0) onError();
        }} onError={onError} />
    </a>
    <dialog ref={dialogRef} className={styles.imageDialog} aria-label={`Фото: ${name}`}
      onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
      <button type="button" className={styles.imageClose} aria-label="Закрыть фото" title="Закрыть фото" onClick={() => dialogRef.current?.close()}>
        <X size={22} aria-hidden="true" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={onError} />
    </dialog>
  </>;
}

export function MessageAttachment({ name, type, size, url, downloadUrl, refreshUrl, presentation = "message" }: {
  name: string; type: string; size: number; url: string | null; downloadUrl: string | null;
  refreshUrl?: string;
  presentation?: "message" | "post";
}) {
  const image = ["image/jpeg", "image/png", "image/webp"].includes(type);
  const audio = type.startsWith("audio/");
  const video = ["video/mp4", "video/webm"].includes(type);
  const media = image || audio || video;
  const extension = name.includes(".") ? name.split(".").pop()?.toUpperCase() : null;
  const description = `${extension || (image ? "Фото" : audio ? "Аудио" : video ? "Видео" : "Файл")} · ${formatAttachmentSize(size)}`;
  const [renewed, setRenewed] = useState<{ original: string | null; url: string | null }>();
  const [busy, setBusy] = useState(false);
  const attempting = useRef(false);
  const attempted = useRef(false);
  const currentUrl = renewed && renewed.original === url ? renewed.url : url;
  const fileUrl = refreshUrl || downloadUrl || url;

  async function requestFreshUrl() {
    if (!refreshUrl) return null;
    try {
      const response = await fetch(`${refreshUrl}?format=json`, {
        cache: "no-store", signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return typeof payload.url === "string" ? payload.url : null;
    } catch {
      return null;
    }
  }

  async function renewMedia(automatic: boolean) {
    if (!refreshUrl || attempting.current) return;
    if (automatic && attempted.current) {
      setRenewed({ original: url, url: null });
      return;
    }
    attempted.current = true;
    attempting.current = true;
    setBusy(true);
    const next = await requestFreshUrl();
    setRenewed({ original: url, url: next === currentUrl ? null : next });
    setBusy(false);
    attempting.current = false;
  }
  const FileIcon = type === "application/zip" ? FileArchive : FileText;

  return <div className={`${styles.attachment}${presentation === "post" && (image || video) ? ` ${styles.postMedia}` : ""}`}>
    {currentUrl && image && <ImageAttachment key={refreshUrl ?? currentUrl} name={name} url={currentUrl} onError={() => void renewMedia(true)} />}
    {currentUrl && audio && <AudioPlayer src={currentUrl} title={name} hideDownload
      renewSource={refreshUrl ? requestFreshUrl : undefined} />}
    {currentUrl && video && <video className={styles.mediaVideo} controls controlsList="nodownload" preload="metadata"
      src={currentUrl} aria-label={`Видео: ${name}`}
      ref={(element) => { if (element?.error) void renewMedia(true); }}
      onError={() => void renewMedia(true)}>
      Ваш браузер не поддерживает воспроизведение видео.
    </video>}
    {!media && fileUrl && <a href={fileUrl} className={styles.fileCard} target="_blank" rel="noopener noreferrer" aria-label={`Открыть файл: ${name}`}>
      <FileIcon size={24} aria-hidden="true" />
      <div><strong>{name}</strong><p className="muted small">{description}</p></div>
      <span className={styles.fileOpen}>Открыть <ExternalLink size={14} aria-hidden="true" /></span>
    </a>}
    {((media && !currentUrl) || (!media && !fileUrl)) && <div className={styles.fileCard}>
      <FileIcon size={24} aria-hidden="true" />
      <div><strong>{name}</strong><p className="muted small">{description}</p>
        {refreshUrl ? <button type="button" className="button button-quiet" disabled={busy}
          onClick={() => void renewMedia(false)}>{busy ? "Обновляем…" : "Обновить ссылку"}</button>
          : <span className="muted small">Файл недоступен. Обнови страницу.</span>}
      </div>
    </div>}
  </div>;
}
