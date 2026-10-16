"use client";
import Link from "next/link";
import { useTransition } from "react";
export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <main id="main" className="auth-page">
      <div className="card empty-state">
        <h1>Не удалось загрузить страницу</h1>
        <p role="alert" style={{ marginTop: 15 }}>
          Проверь подключение и попробуй ещё раз. Если ошибка повторяется,
          вернись позже.
        </p>
        <div
          className="row"
          style={{ justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}
        >
          <button type="button" className="button button-primary" disabled={pending} onClick={() => startTransition(retry)}>
            {pending ? "Загружаем…" : "Повторить"}
          </button>
          <Link href="/" className="button button-secondary">
            На главную
          </Link>
        </div>
      </div>
    </main>
  );
}
