import Link from "next/link";
export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="NEXUS — главная">
      <span className="brand-symbol" aria-hidden="true">
        n<span>·</span>
      </span>
      <span>NEXUS</span>
    </Link>
  );
}
