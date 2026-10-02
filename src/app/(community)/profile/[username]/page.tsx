import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  GraduationCap,
  Pencil,
  UsersRound,
} from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { displayName } from "@/lib/format";
import { getProfileByUsername } from "@/features/profiles/data";
import { Avatar } from "@/components/ui/avatar";
import { Notice } from "@/components/ui/notice";
import { StartConversationButton } from "@/features/messages/forms";
import { getFriendships } from "@/features/profiles/friendships";
import { FriendControls } from "@/features/profiles/friend-controls";

export const metadata: Metadata = { title: "Профиль" };

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { username } = await params;
  const user = await requireUser(`/profile/${username}`);
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();
  const isOwner = profile.id === user.id;
  const relationship = isOwner ? null : (await getFriendships(user.id))
    .find((row) => row.requester_id === profile.id || row.addressee_id === profile.id);
  const query = await searchParams;
  const name = displayName(profile);
  const joined = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(profile.created_at));
  return (
    <div className="profile-page">
      <Link href="/feed" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> В студенческую ленту
      </Link>
      {isOwner && query.saved === "1" && (
        <Notice tone="success">Профиль сохранён.</Notice>
      )}
      <article className="card profile-card">
        <div className="profile-cover" aria-hidden="true">
          <Image src="/nexus-artwork.png" alt="" fill
            sizes="(max-width: 600px) 100vw, (max-width: 1150px) 70vw, 790px"
            className="profile-cover-image" />
          <span>NEXUS / COMMUNITY</span>
          <span>На одной волне.</span>
        </div>
        <div className="profile-body">
          <div className="profile-topline">
            <Avatar name={name} url={profile.avatar_url} size="lg" />
            {isOwner && (
              <Link href="/profile/edit" className="button button-secondary">
                <Pencil size={15} aria-hidden="true" /> Редактировать
              </Link>
            )}
            {!isOwner && <div className="friend-controls">
              <StartConversationButton userId={profile.id} />
              <FriendControls otherId={profile.id} state={!relationship ? "none" : relationship.status === "accepted"
                ? "friends" : relationship.requester_id === user.id ? "request_sent" : "request_received"} />
            </div>}
          </div>
          <div className="profile-name">
            <h1>{name}</h1>
            <p className="muted">@{profile.username}</p>
          </div>
          <p className="profile-bio">
            {profile.bio ||
              (isOwner
                ? "Пара слов о себе поможет найти своих. Добавь описание в настройках профиля."
                : "Пока без описания. Знакомство начинается с разговора.")}
          </p>
          <div className="profile-details">
            {profile.specialty && (
              <span>
                <GraduationCap size={17} aria-hidden="true" />
                {profile.specialty}
              </span>
            )}
            {(profile.course || profile.group_name) && (
              <span>
                <UsersRound size={17} aria-hidden="true" />
                {[
                  profile.course ? `${profile.course} курс` : "",
                  profile.group_name,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
            <span>
              <CalendarDays size={17} aria-hidden="true" />В NEXUS с{" "}
              <time dateTime={profile.created_at}>{joined}</time>
            </span>
          </div>
          <section
            className="profile-interests"
            aria-labelledby="profile-interests-title"
          >
            <h2 id="profile-interests-title">На одной волне</h2>
            {profile.interests.length ? (
              <div className="tag-list">
                {profile.interests.map((interest) => (
                  <span className="tag" key={interest.id}>
                    #{interest.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted">Интересы ещё не указаны.</p>
            )}
          </section>
        </div>
      </article>
    </div>
  );
}
