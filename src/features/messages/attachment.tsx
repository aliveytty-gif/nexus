import { FileText } from "lucide-react";
import { AudioPlayer } from "@/components/ui/audio-player";
import { formatAttachmentSize } from "@/lib/storage";
import styles from "./messages.module.css";

export function MessageAttachment({ name, type, size, url, downloadUrl }: {
  name: string; type: string; size: number; url: string | null; downloadUrl: string | null;
}) {
  const image = ["image/jpeg", "image/png", "image/webp"].includes(type);
  return <div className={styles.attachment}>
    {url && image && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Открыть фото: ${name}`}>
      {/* Private URLs must not pass through the public image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name} className={styles.mediaImage} loading="lazy" referrerPolicy="no-referrer" />
    </a>}
    {url && type.startsWith("audio/") && <AudioPlayer src={url} title={name} />}
    <div className={styles.fileCard}>
      <FileText size={20} aria-hidden="true" />
      <div><strong>{name}</strong>
        <p className="muted small">{name.split(".").pop()?.toUpperCase()} · {formatAttachmentSize(size)}</p>
        {downloadUrl ? <a href={downloadUrl} className="text-link" target="_blank" rel="noopener noreferrer">Скачать файл</a>
          : <span className="muted small">Файл недоступен. Нажми «Обновить».</span>}
      </div>
    </div>
  </div>;
}
