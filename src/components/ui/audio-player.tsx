"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, Pause, Play, X } from "lucide-react";
import styles from "@/features/messages/messages.module.css";

type AudioPlayerProps = { src: string; title: string; hideDownload?: boolean };
type PlaybackState = {
  playing: boolean; busy: boolean; metadataLoading: boolean;
  duration: number; currentTime: number; error: string | null;
};
type AudioTrack = AudioPlayerProps & { key: string };
type SharedPlayback = {
  track: AudioTrack | null; state: PlaybackState;
  toggle: (track: AudioTrack) => void; seek: (time: number) => void;
};
const idleState: PlaybackState = {
  playing: false, busy: false, metadataLoading: false,
  duration: 0, currentTime: 0, error: null,
};
const AudioContext = createContext<SharedPlayback | null>(null);

function trackKey(src: string) {
  try {
    const url = new URL(src);
    // Token rotation must not restart a private track when its page is reopened.
    if (url.pathname.startsWith("/storage/v1/object/sign/")) return `${url.origin}${url.pathname}`;
  } catch { /* Relative and non-Storage URLs retain their complete identity. */ }
  return src;
}

export function PersistentAudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<AudioTrack | null>(null);
  const playRequest = useRef(0);
  const pendingPlay = useRef(false);
  const [track, setTrack] = useState<AudioTrack | null>(null);
  const [state, setState] = useState<PlaybackState>(idleState);

  const close = useCallback(() => {
    playRequest.current += 1;
    pendingPlay.current = false;
    trackRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setTrack(null);
    setState(idleState);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    function handleOtherPlayback(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLMediaElement)) return;
      if (target === audio) {
        document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((element) => {
          if (element !== audio && !element.paused) element.pause();
        });
      } else {
        playRequest.current += 1;
        pendingPlay.current = false;
        audio?.pause();
        setState((previous) => ({ ...previous, playing: false, busy: false }));
      }
    }
    document.addEventListener("play", handleOtherPlayback, true);
    return () => {
      document.removeEventListener("play", handleOtherPlayback, true);
      playRequest.current += 1;
      pendingPlay.current = false;
      trackRef.current = null;
      audio?.pause();
      audio?.removeAttribute("src");
      audio?.load();
    };
  }, []);

  async function toggle(nextTrack: AudioTrack) {
    const audio = audioRef.current;
    if (!audio) return;
    const sameTrack = trackRef.current?.key === nextTrack.key;
    if (sameTrack && (!audio.paused || pendingPlay.current)) {
      playRequest.current += 1;
      pendingPlay.current = false;
      audio.pause();
      setState((previous) => ({ ...previous, playing: false, busy: false }));
      return;
    }
    const request = ++playRequest.current;
    pendingPlay.current = true;
    if (!sameTrack || audio.error) {
      audio.pause();
      audio.src = nextTrack.src;
      setState({ ...idleState, busy: true, metadataLoading: true });
    } else {
      setState((previous) => ({ ...previous, busy: true, error: null }));
    }
    trackRef.current = nextTrack;
    setTrack(nextTrack);
    try {
      await audio.play();
      if (request === playRequest.current) pendingPlay.current = false;
    } catch (reason) {
      if (request !== playRequest.current) return;
      pendingPlay.current = false;
      const aborted = reason instanceof DOMException && reason.name === "AbortError";
      setState((previous) => ({ ...previous, busy: false, playing: false,
        error: aborted ? null : "Не удалось воспроизвести аудио. Обнови страницу и попробуй снова." }));
    }
  }

  function seek(nextTime: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = Math.min(audio.duration, Math.max(0, nextTime));
    setState((previous) => ({ ...previous, currentTime: audio.currentTime }));
  }

  function updateMetadata() {
    const audio = audioRef.current;
    if (!audio || !trackRef.current) return;
    setState((previous) => ({ ...previous,
      duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0,
      currentTime: audio.currentTime, metadataLoading: false }));
  }

  return <AudioContext.Provider value={{ track, state, toggle, seek }}>
    <div onSubmitCapture={(event) => {
      if (event.target instanceof HTMLFormElement && event.target.hasAttribute("data-stop-audio")) close();
    }}>
      {children}
      <audio ref={audioRef} preload="none" className={styles.audioElement}
        aria-label={track?.title || "Аудиоплеер"} controlsList={track?.hideDownload ? "nodownload" : undefined}
        onLoadedMetadata={updateMetadata} onDurationChange={updateMetadata}
        onTimeUpdate={(event) => {
          const currentTime = event.currentTarget.currentTime;
          if (trackRef.current) setState((previous) => ({ ...previous, currentTime }));
        }}
        onPlaying={() => { pendingPlay.current = false; setState((previous) => ({ ...previous, playing: true, busy: false })); }}
        onWaiting={() => { if (trackRef.current) setState((previous) => ({ ...previous, busy: true })); }}
        onPause={() => setState((previous) => ({ ...previous, playing: false, busy: false }))}
        onEnded={() => setState((previous) => ({ ...previous, playing: false, busy: false }))}
        onError={() => {
          if (!trackRef.current) return;
          pendingPlay.current = false;
          setState((previous) => ({ ...previous, playing: false, busy: false, metadataLoading: false,
            error: "Аудио недоступно. Обнови страницу и попробуй снова." }));
        }} />
      {track && <div className={styles.persistentAudio} data-persistent-audio role="group" aria-label="Текущий аудиотрек">
        <AudioControls title={track.title} state={state} onToggle={() => void toggle(track)} onSeek={seek} />
        <button className={styles.audioClose} type="button" onClick={close} aria-label="Закрыть аудиоплеер" title="Закрыть аудиоплеер">
          <X size={18} aria-hidden="true" />
        </button>
      </div>}
    </div>
  </AudioContext.Provider>;
}

function formatTime(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

export function AudioPlayer(props: AudioPlayerProps) {
  const shared = useContext(AudioContext);
  if (shared) {
    const key = trackKey(props.src);
    const active = shared.track?.key === key;
    return <div className={styles.audioPlayer}>
      <AudioControls title={props.title} state={active ? shared.state : idleState}
        onToggle={() => shared.toggle({ ...props, key })} onSeek={shared.seek} />
      <noscript><audio controls preload="none" src={props.src} controlsList={props.hideDownload ? "nodownload" : undefined} aria-label={props.title} /></noscript>
    </div>;
  }
  // Keep standalone usage working outside the persistent community layout.
  return <AudioPlayerContent key={props.src} {...props} />;
}

function AudioControls({ title, state, onToggle, onSeek }: {
  title: string; state: PlaybackState; onToggle: () => void; onSeek: (time: number) => void;
}) {
  const { currentTime, duration, playing, busy, metadataLoading, error } = state;
  const time = Math.min(currentTime, duration || currentTime);
  const controlLabel = playing ? `Пауза: ${title}` : `Воспроизвести: ${title}`;
  return <>
    <button type="button" className={styles.audioButton} onClick={onToggle}
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
          title="Перемотать аудио" onChange={(event) => onSeek(Number(event.target.value))} />
        <span className={styles.audioTime}>{formatTime(time)} / {metadataLoading ? "…" : formatTime(duration)}</span>
      </div>
      <span className={styles.audioStatus} role="status">{error || (busy ? "Загрузка аудио…" : metadataLoading ? "Загрузка длительности…" : "")}</span>
    </div>
  </>;
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
    <AudioControls title={title} state={{ currentTime, duration, playing, busy, metadataLoading, error }}
      onToggle={() => void togglePlayback()} onSeek={(value) => {
        if (!audioRef.current || !duration) return;
        const nextTime = Math.min(duration, Math.max(0, value));
        audioRef.current.currentTime = nextTime;
        setCurrentTime(nextTime);
      }} />
    <noscript><audio controls controlsList={hideDownload ? "nodownload" : undefined} preload="metadata" src={src} aria-label={title} /></noscript>
  </div>;
}
