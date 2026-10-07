"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import styles from "@/features/messages/messages.module.css";

type AudioPlayerProps = { src: string; title: string; hideDownload?: boolean };

function formatTime(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

export function AudioPlayer(props: AudioPlayerProps) {
  // A refreshed signed URL starts with fresh playback state and a new media element.
  return <AudioPlayerContent key={props.src} {...props} />;
}

function AudioPlayerContent({ src, title, hideDownload = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playRequest = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const bindAudio = useCallback((audio: HTMLAudioElement | null) => {
    audioRef.current = audio;
    // Metadata may finish loading before React hydrates the server-rendered audio.
    if (audio && audio.readyState >= 1) {
      setDuration(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
      setCurrentTime(audio.currentTime);
      setPlaying(!audio.paused);
      setMetadataLoading(false);
    } else if (audio?.error) {
      setMetadataLoading(false);
      setError("Аудио недоступно. Обнови страницу и попробуй снова.");
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      playRequest.current += 1;
      audio?.pause();
    };
  }, []);

  function updateMetadata() {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
    setMetadataLoading(false);
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      playRequest.current += 1;
      audio.pause();
      setBusy(false);
      return;
    }
    const request = ++playRequest.current;
    setError(null);
    setBusy(true);
    try {
      await audio.play();
    } catch (reason) {
      if (request !== playRequest.current) return;
      setBusy(false);
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError("Не удалось воспроизвести аудио. Обнови страницу и попробуй снова.");
    }
  }

  const time = Math.min(currentTime, duration || currentTime);
  const controlLabel = playing ? `Пауза: ${title}` : `Воспроизвести: ${title}`;

  return <div className={styles.audioPlayer}>
    <audio ref={bindAudio} src={src} preload="metadata" controlsList={hideDownload ? "nodownload" : undefined}
      className={styles.audioElement} aria-label={title}
      onLoadStart={() => setMetadataLoading(true)} onLoadedMetadata={updateMetadata} onDurationChange={updateMetadata}
      onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)} onPlaying={() => { setPlaying(true); setBusy(false); }}
      onWaiting={() => setBusy(true)} onCanPlay={() => setBusy(false)}
      onPause={() => { setPlaying(false); setBusy(false); }}
      onEnded={() => { setPlaying(false); setBusy(false); }}
      onError={() => { setPlaying(false); setBusy(false); setMetadataLoading(false); setError("Аудио недоступно. Обнови страницу и попробуй снова."); }} />
    <button type="button" className={styles.audioButton} onClick={togglePlayback}
      aria-label={controlLabel} title={controlLabel} aria-pressed={playing}>
      {busy ? <LoaderCircle size={20} aria-hidden="true" className={styles.audioSpinner} />
        : playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
    </button>
    <div className={styles.audioContent}>
      <strong className={styles.audioTitle} title={title}>{title}</strong>
      <div className={styles.audioTimeline}>
        <input type="range" min={0} max={duration || 1} step={0.1} value={duration ? time : 0}
          disabled={!duration || Boolean(error)} className={styles.audioSeek}
          aria-label={`Позиция воспроизведения: ${title}`} aria-valuetext={`${formatTime(time)} из ${formatTime(duration)}`}
          title="Перемотать аудио" onChange={(event) => {
            if (!audioRef.current || !duration) return;
            const nextTime = Math.min(duration, Math.max(0, Number(event.target.value)));
            audioRef.current.currentTime = nextTime;
            setCurrentTime(nextTime);
          }} />
        <span className={styles.audioTime}>{formatTime(time)} / {metadataLoading ? "…" : formatTime(duration)}</span>
      </div>
      <span className={styles.audioStatus} role="status">{error || (busy ? "Загрузка аудио…" : metadataLoading ? "Загрузка длительности…" : "")}</span>
    </div>
    <noscript><audio controls controlsList={hideDownload ? "nodownload" : undefined} preload="metadata" src={src} aria-label={title} /></noscript>
  </div>;
}
