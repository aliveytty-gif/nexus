"use client";

import Link from "next/link";
import { useTransition } from "react";

export default function CommunityError({ retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <section className="card empty-state" aria-labelledby="section-error-title">
      <h1 id="section-error-title">Не удалось загрузить раздел</h1>
      <p role="alert">Проверь подключение и попробуй ещё раз. Можно также перейти в другой раздел через меню.</p>
      <div className="row" style={{ justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}>
        <button type="button" className="button button-primary" disabled={pending} onClick={() => startTransition(retry)}>
          {pending ? "Загружаем…" : "Повторить"}
        </button>
        <Link href="/feed" className="button button-secondary">В ленту</Link>
      </div>
    </section>
  );
}
