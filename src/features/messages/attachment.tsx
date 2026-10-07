"use client";

import { useRef } from "react";
import { ExternalLink, FileArchive, FileText, X } from "lucide-react";
import { AudioPlayer } from "@/components/ui/audio-player";
import { formatAttachmentSize } from "@/lib/storage";
import styles from "./messages.module.css";

function ImageAttachment({ name, url }: { name: string; url: string }) {
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
      <img src={url} alt={name} className={styles.mediaImage} loading="lazy" referrerPolicy="no-referrer" />
    </a>
    <dialog ref={dialogRef} className={styles.imageDialog} aria-label={`Фото: ${name}`}
      onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
      <button type="button" className={styles.imageClose} aria-label="Закрыть фото" title="Закрыть фото" onClick={() => dialogRef.current?.close()}>
        <X size={22} aria-hidden="true" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name} loading="lazy" referrerPolicy="no-referrer" />
      <p>{name}</p>
    </dialog>
  </>;
}

export function MessageAttachment({ name, type, size, url, downloadUrl }: {
  name: string; type: string; size: number; url: string | null; downloadUrl: string | null;
}) {
  const image = ["image/jpeg", "image/png", "image/webp"].includes(type);
  const audio = type.startsWith("audio/");
  const video = ["video/mp4", "video/webm"].includes(type);
  const media = image || audio || video;
  const extension = name.includes(".") ? name.split(".").pop()?.toUpperCase() : null;
  const description = `${extension || (image ? "Фото" : audio ? "Аудио" : video ? "Видео" : "Файл")} · ${formatAttachmentSize(size)}`;
  const fileUrl = downloadUrl || url;
  const FileIcon = type === "application/zip" ? FileArchive : FileText;

  return <div className={styles.attachment}>
    {url && image && <ImageAttachment key={url} name={name} url={url} />}
    {url && audio && <AudioPlayer src={url} title={name} hideDownload />}
    {url && video && <video className={styles.mediaVideo} controls controlsList="nodownload" preload="metadata" src={url} aria-label={`Видео: ${name}`}>
      Ваш браузер не поддерживает воспроизведение видео.
    </video>}
    {url && media && <div className={styles.mediaCaption}>
      {!audio && <strong>{name}</strong>}
      <p className="muted small">{description}</p>
    </div>}
    {!media && fileUrl && <a href={fileUrl} className={styles.fileCard} target="_blank" rel="noopener noreferrer" aria-label={`Открыть файл: ${name}`}>
      <FileIcon size={24} aria-hidden="true" />
      <div><strong>{name}</strong><p className="muted small">{description}</p></div>
      <span className={styles.fileOpen}>Открыть <ExternalLink size={14} aria-hidden="true" /></span>
    </a>}
    {((media && !url) || (!media && !fileUrl)) && <div className={styles.fileCard}>
      <FileIcon size={24} aria-hidden="true" />
      <div><strong>{name}</strong><p className="muted small">{description}</p>
        <span className="muted small">Файл недоступен. Обнови страницу.</span>
      </div>
    </div>}
  </div>;
}
