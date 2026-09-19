import Link from "next/link";
import { Brand } from "@/components/brand";
export const metadata = { title: "Подключение" };
export default function SetupPage() {
  return (
    <main id="main" className="setup-content">
      <Brand />
      <div className="card">
        <p className="eyebrow">Первый запуск</p>
        <h1 style={{ marginTop: 12 }}>Подключите NEXUS к Supabase</h1>
        <p className="muted">
          Для регистрации и публикаций нужна база вашего проекта. Настройка
          выполняется один раз разработчиком.
        </p>
        <ol>
          <li>
            Создайте проект на{" "}
            <a
              className="text-link"
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noreferrer"
            >
              supabase.com
            </a>
            .
          </li>
          <li>
            Примените SQL из <code>supabase/migrations/</code> в SQL Editor.
          </li>
          <li>
            Скопируйте <code>.env.example</code> в <code>.env.local</code> и
            добавьте Project URL и publishable key.
          </li>
          <li>
            Настройте адреса подтверждения email по README и перезапустите
            сервер.
          </li>
        </ol>
        <pre>
          <code>
            {
              "NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY\nNEXT_PUBLIC_SITE_URL=http://localhost:3000"
            }
          </code>
        </pre>
        <p className="muted small" style={{ marginTop: 18 }}>
          Подробная инструкция для macOS и Windows находится в README.md в папке
          проекта.
        </p>
        <Link
          href="/"
          className="button button-secondary"
          style={{ marginTop: 25 }}
        >
          На главную
        </Link>
      </div>
    </main>
  );
}
