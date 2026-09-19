import Link from "next/link";
import { LogOut } from "lucide-react";
import { Brand } from "@/components/brand";
import { Avatar } from "@/components/ui/avatar";
import { SubmitButton } from "@/components/ui/submit-button";
import { Navigation } from "@/components/layout/navigation";
import { requireUser } from "@/lib/auth/session";
import { displayName } from "@/lib/format";
import { getProfileById } from "@/features/profiles/data";
import { logoutAction } from "@/features/auth/actions";
export const dynamic = "force-dynamic";
export default async function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const profile = await getProfileById(user.id);
  if (!profile)
    throw new Error("Профиль не создан. Проверьте миграцию и триггер Auth.");
  const name = displayName(profile);
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="row">
            <Brand href="/feed" />
            <span className="header-divider" />
            <span className="header-label">Твоё сообщество колледжа</span>
          </div>
          <div className="row">
            <Link
              href={`/profile/${profile.username}`}
              className="header-profile"
            >
              <Avatar name={name} url={profile.avatar_url} size="sm" />
              <span>{name}</span>
            </Link>
            <form action={logoutAction}>
              <SubmitButton
                className="button button-quiet"
                pendingText="Выход…"
              >
                <LogOut size={17} />
                <span>Выйти</span>
              </SubmitButton>
            </form>
          </div>
        </div>
      </header>
      <div className="app-grid">
        <aside className="sidebar">
          <p className="eyebrow sidebar-label">Сообщество</p>
          <Navigation username={profile.username} />
          <div className="sidebar-footer">
            <p className="sidebar-note">
              Разные группы.
              <br />
              Один колледж.
            </p>
            <p className="sidebar-note">NEXUS · Первая версия</p>
          </div>
        </aside>
        <main id="main" className="content">
          {children}
        </main>
      </div>
    </div>
  );
}
