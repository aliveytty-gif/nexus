"use client";
import Link from "next/link";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="auth-page">
      <div className="card empty-state">
        <h1>Не удалось загрузить страницу</h1>
        <p style={{ marginTop: 15 }}>
          Проверьте подключение и попробуйте ещё раз. Если это первый запуск,
          проверьте настройки Supabase и миграции по README.
        </p>
        <div
          className="row"
          style={{ justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}
        >
          <button className="button button-primary" onClick={reset}>
            Повторить
          </button>
          <Link href="/" className="button button-secondary">
            На главную
          </Link>
        </div>
      </div>
    </main>
  );
}
