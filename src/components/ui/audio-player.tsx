export function AudioPlayer({ src, title }: { src: string; title: string }) {
  return <audio controls preload="none" src={src} aria-label={title}
    style={{ display: "block", width: "100%", maxWidth: 460, minWidth: 0 }}>
    Ваш браузер не поддерживает воспроизведение аудио.
  </audio>;
}
