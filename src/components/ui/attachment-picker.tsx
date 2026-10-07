"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileText, ImagePlus, Music2, Paperclip, RotateCcw, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AUDIO_ACCEPT, PHOTO_VIDEO_ACCEPT, MESSAGE_FILE_ACCEPT, MAX_ATTACHMENTS, formatAttachmentSize,
  uploadAttachment, validateMessageFile, type AttachmentScope, type MessageAttachment } from "@/lib/storage";

type Selection = { id: string; file: File; preview?: string; attachment?: MessageAttachment;
  progress: number; status: "uploading" | "ready" | "error" | "removing"; error?: string };

export function AttachmentPicker({ scope, conversationId, disabled = false, onChange }: {
  scope: AttachmentScope; conversationId?: string; disabled?: boolean;
  onChange: (attachments: MessageAttachment[], busy: boolean) => void;
}) {
  const [items, setItems] = useState<Selection[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const transfers = useRef(new Map<string, { controller: AbortController; done: Promise<void>; path?: string }>());
  const previews = useRef(new Set<string>());
  const helpId = useId();
  const bucket = scope === "message" ? "message-files" : "post-files";
  useEffect(() => {
    onChange(items.flatMap((item) => item.status === "ready" && item.attachment ? [item.attachment] : []),
      items.some((item) => item.status !== "ready"));
  }, [items, onChange]);
  useEffect(() => {
    const active = transfers.current;
    const urls = previews.current;
    return () => {
      active.forEach((transfer) => transfer.controller.abort());
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function update(id: string, change: Partial<Selection>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));
  }

  function start(item: Selection) {
    const controller = new AbortController();
    const transfer = { controller, done: Promise.resolve(), path: undefined as string | undefined };
    transfers.current.set(item.id, transfer);
    update(item.id, { status: "uploading", progress: 0, error: undefined });
    transfer.done = (async () => {
      try {
        const attachment = await uploadAttachment(createClient(), scope, conversationId, item.file, {
          signal: controller.signal,
          onProgress: (progress) => update(item.id, { progress }),
          onPath: (path) => { transfer.path = path; },
        });
        if (!controller.signal.aborted) update(item.id, { attachment, status: "ready", progress: 100 });
      } catch (cause) {
        if (!controller.signal.aborted)
          update(item.id, { status: "error", error: cause instanceof Error ? cause.message : "Не удалось загрузить файл." });
      }
    })();
  }

  function choose(files: File[]) {
    if (disabled) return;
    setError("");
    if (items.length + files.length > MAX_ATTACHMENTS) {
      setError(`В одной отправке — до ${MAX_ATTACHMENTS} файлов. Уберите лишние и попробуйте снова.`);
      return;
    }
    const valid: Selection[] = [];
    for (const file of files) {
      const validation = validateMessageFile(file);
      if (validation) { setError(`${file.name}: ${validation}`); continue; }
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      if (preview) previews.current.add(preview);
      valid.push({ id: crypto.randomUUID(), file, preview, progress: 0, status: "uploading" });
    }
    setItems((current) => [...current, ...valid]);
    valid.forEach(start);
  }

  async function remove(item: Selection, retry = false) {
    update(item.id, { status: "removing", error: undefined });
    const transfer = transfers.current.get(item.id);
    transfer?.controller.abort();
    await transfer?.done;
    const path = item.attachment?.path ?? transfer?.path;
    try {
      if (path) {
        const { error } = await createClient().storage.from(bucket).remove([path]);
        if (error) throw error;
      }
      transfers.current.delete(item.id);
      if (retry) { start(item); return; }
      if (item.preview) { URL.revokeObjectURL(item.preview); previews.current.delete(item.preview); }
      setItems((current) => current.filter((selected) => selected.id !== item.id));
    } catch {
      update(item.id, { status: "error", error: "Не удалось убрать файл. Нажмите × ещё раз." });
    }
  }

  function open(accept: string) {
    if (!input.current) return;
    input.current.accept = accept;
    input.current.click();
    if (menu.current) menu.current.open = false;
  }

  return <div className={`attachment-picker${dragging ? " attachment-picker-dragging" : ""}`}
    onDragOver={(event) => { if (!disabled && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={(event) => { event.preventDefault(); setDragging(false); choose(Array.from(event.dataTransfer.files)); }}>
    <div className="attachment-toolbar">
      <details ref={menu} className="attachment-menu" onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }}>
        <summary className="button button-secondary" aria-disabled={disabled || items.length >= MAX_ATTACHMENTS}
          aria-describedby={helpId} onClick={(event) => { if (disabled || items.length >= MAX_ATTACHMENTS) event.preventDefault(); }}>
          <Paperclip size={18} aria-hidden="true" /> Прикрепить
        </summary>
        <div className="attachment-options">
          <button type="button" disabled={disabled} onClick={() => open(PHOTO_VIDEO_ACCEPT)}><ImagePlus size={18} aria-hidden="true" /> Фото / видео</button>
          <button type="button" disabled={disabled} onClick={() => open(AUDIO_ACCEPT)}><Music2 size={18} aria-hidden="true" /> Аудио</button>
          <button type="button" disabled={disabled} onClick={() => open(MESSAGE_FILE_ACCEPT)}><FileText size={18} aria-hidden="true" /> Файл</button>
        </div>
      </details>
      <span id={helpId} className="muted small">До 10 файлов · 10 МБ каждый<span className="attachment-desktop-hint"> · можно перетащить сюда</span></span>
      <input ref={input} type="file" multiple hidden disabled={disabled} aria-label="Выбрать вложения"
        onChange={(event) => { choose(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    </div>
    {items.length > 0 && <ul className="attachment-selections" aria-label="Выбранные вложения">
      {items.map((item) => <li key={item.id} className="file-selection">
        {item.preview ? /* eslint-disable-next-line @next/next/no-img-element */
          <img src={item.preview} alt={`Предпросмотр: ${item.file.name}`} /> : item.file.type.startsWith("audio/")
            ? <Music2 size={24} aria-hidden="true" /> : <FileText size={24} aria-hidden="true" />}
        <div className="file-selection-info">
          <strong>{item.file.name}</strong>
          <p className="muted small">{formatAttachmentSize(item.file.size)}</p>
          {item.status === "uploading" && <><progress max={100} value={item.progress} aria-label={`Загрузка ${item.file.name}`} />
            <span className="muted small" role="status">{item.progress === 100 ? "Сохраняем…" : `Загрузка ${item.progress}%`}</span></>}
          {item.status === "ready" && <span className="muted small" role="status">Готов к отправке</span>}
          {item.status === "removing" && <span className="muted small" role="status">Убираем…</span>}
          {item.error && <span className="attachment-error" role="alert">{item.error}</span>}
        </div>
        {item.status === "error" && <button type="button" className="button button-quiet" disabled={disabled}
          aria-label={`Повторить загрузку: ${item.file.name}`} onClick={() => void remove(item, true)}><RotateCcw size={18} aria-hidden="true" /></button>}
        <button type="button" className="button button-quiet" disabled={disabled || item.status === "removing"}
          aria-label={`${item.status === "uploading" ? "Отменить загрузку" : "Убрать файл"}: ${item.file.name}`}
          onClick={() => void remove(item)}><X size={18} aria-hidden="true" /></button>
      </li>)}
    </ul>}
    {items.some((item) => item.status === "error") && <p className="muted small" role="status">Повторите загрузку или уберите файл, чтобы отправить.</p>}
    {error && <p className="attachment-error" role="alert">{error}</p>}
  </div>;
}
