import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getInterests, getProfileById } from "@/features/profiles/data";
import { ProfileForm } from "@/features/profiles/profile-form";
import { Notice } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Редактирование профиля" };

export default async function EditProfilePage() {
  const user = await requireUser("/profile/edit");
  const [profile, interests] = await Promise.all([
    getProfileById(user.id),
    getInterests(),
  ]);
  return (
    <div className="profile-page">
      <div className="page-heading">
        <p className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</p>
        <h1>Больше о тебе.</h1>
        <p className="muted">Эту информацию увидят другие участники NEXUS.</p>
      </div>
      {profile ? (
        <ProfileForm profile={profile} interests={interests} />
      ) : (
        <Notice tone="error">
          Профиль не создан. Примените миграции Supabase и зарегистрируйте новый
          аккаунт; для существующего аккаунта администратор проекта должен
          восстановить запись профиля.
        </Notice>
      )}
    </div>
  );
}
