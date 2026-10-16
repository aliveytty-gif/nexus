import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getCommunity } from "@/features/communities/data";
import { CommunityForm } from "@/features/communities/forms";
import { UUID_PATTERN } from "@/features/posts/validation";

export const metadata = { title: "Редактировать сообщество" };

export default async function EditCommunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const user = await requireUser(`/communities/${id}/edit`);
  const { community } = await getCommunity(id, user.id);
  if (!community || community.owner_id !== user.id) notFound();
  return <div className="stack">
    <Link href={`/communities/${id}`} className="back-link">← Сообщество</Link>
    <div className="page-heading"><div><h1>Редактировать сообщество</h1>
      <p>Измени название, описание или фото.</p>
    </div></div>
    <CommunityForm community={community} />
  </div>;
}
