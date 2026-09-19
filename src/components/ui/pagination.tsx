import Link from "next/link";
export function Pagination({
  page,
  total,
  perPage,
  href,
}: {
  page: number;
  total: number;
  perPage: number;
  href: string;
}) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1 && page === 1) return null;
  return (
    <nav className="pagination" aria-label="Страницы">
      {page > 1 ? (
        <Link
          href={`${href}?page=${page - 1}`}
          className="button button-secondary"
        >
          Назад
        </Link>
      ) : (
        <span />
      )}
      <span className="muted">
        {page} / {Math.max(1, pages)}
      </span>
      {page < pages ? (
        <Link
          href={`${href}?page=${page + 1}`}
          className="button button-secondary"
        >
          Дальше
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
