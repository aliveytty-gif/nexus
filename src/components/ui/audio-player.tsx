export function AudioPlayer({ src, title, hideDownload = false }: { src: string; title: string; hideDownload?: boolean }) {
  return <audio controls controlsList={hideDownload ? "nodownload" : undefined} preload="none" src={src} aria-label={title}
    style={{ display: "block", width: "100%", maxWidth: 460, minWidth: 0 }}>
    Ваш браузер не поддерживает воспроизведение аудио.
  </audio>;
}
