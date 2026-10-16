export default function Loading() {
  return (
    <section className="route-loading" role="status" aria-live="polite">
      <p className="muted">Загружаем раздел…</p>
      <div className="loading-heading" aria-hidden="true">
        <div className="loading-block loading-line" style={{ width: "48%", height: 25 }} />
        <div className="loading-block loading-line" style={{ width: "70%" }} />
      </div>
      {[0, 1].map((item) => (
        <div key={item} className="card form-stack" aria-hidden="true">
          <div className="loading-row">
            <div className="loading-block loading-avatar" />
            <div className="loading-block loading-line" style={{ width: "38%" }} />
          </div>
          <div className="loading-block loading-line" />
          <div className="loading-block loading-line" style={{ width: "72%" }} />
        </div>
      ))}
    </section>
  );
}
