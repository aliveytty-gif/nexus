import Link from "next/link";
import Image from "next/image";
export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="NEXUS — главная">
      <span className="brand-artwork" aria-hidden="true">
        <Image src="/nexus-artwork.png" alt="" width={1536} height={1024}
          sizes="(max-width: 600px) 132px, 176px" />
      </span>
    </Link>
  );
}
