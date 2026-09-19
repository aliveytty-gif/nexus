import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="auth-page">
      <div className="card empty-state">
        <p className="eyebrow">404</p>
        <h1 style={{ margin: "12px 0" }}>Страница не найдена</h1>
        <p>Ссылка устарела или эта публикация уже удалена.</p>
        <Link href="/feed" className="button button-primary">
          В ленту
        </Link>
      </div>
    </main>
  );
}
