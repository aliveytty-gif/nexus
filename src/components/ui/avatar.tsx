"use client";
import Image from "next/image";
import { useState } from "react";
import { isStorageImage } from "@/lib/storage";

export function Avatar({
  name,
  url,
  size = "md",
}: {
  name: string;
  url?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "N";
  const pixels = { sm: 36, md: 46, lg: 96 }[size];
  const safeUrl = url?.startsWith("https://") ? url : null;
  return (
    <span className={`avatar avatar-${size}`} aria-label={name}>
      {safeUrl && safeUrl !== failedUrl ? (
        <Image
          src={safeUrl}
          alt=""
          width={pixels}
          height={pixels}
          sizes={`${pixels}px`}
          unoptimized={!isStorageImage(safeUrl)}
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(safeUrl)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
