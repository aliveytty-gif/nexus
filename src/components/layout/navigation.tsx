"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutList,
  UserRound,
  MessagesSquare,
  Map,
  Sparkles,
} from "lucide-react";
export function Navigation({ username }: { username: string }) {
  const pathname = usePathname();
  const links = [
    {
      href: "/feed",
      label: "Лента",
      icon: LayoutList,
      active: pathname === "/feed" || pathname.startsWith("/posts/"),
    },
    {
      href: `/profile/${username}`,
      label: "Мой профиль",
      icon: UserRound,
      active: pathname.startsWith("/profile/"),
    },
    {
      href: "/messages",
      label: "Сообщения",
      icon: MessagesSquare,
      soon: true,
      active: pathname === "/messages",
    },
    {
      href: "/map",
      label: "Карта",
      icon: Map,
      soon: true,
      active: pathname === "/map",
    },
    {
      href: "/ai",
      label: "NEXUS AI",
      icon: Sparkles,
      soon: true,
      active: pathname === "/ai",
    },
  ];
  return (
    <nav className="nav-list" aria-label="Разделы NEXUS">
      {links.map(({ href, label, icon: Icon, active, soon }) => (
        <Link
          href={href}
          className={`nav-link${active ? " active" : ""}`}
          aria-current={active ? "page" : undefined}
          key={href}
        >
          <Icon size={20} />
          <span>{label}</span>
          {soon && <span className="soon-badge">скоро</span>}
        </Link>
      ))}
    </nav>
  );
}
