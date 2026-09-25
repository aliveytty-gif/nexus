import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { CommunityForm } from "@/features/communities/forms";

export const metadata = { title: "Создать сообщество" };

export default async function NewCommunityPage() {
  await requireUser("/communities/new");
  return <div className="stack">
    <Link href="/communities" className="back-link">← Сообщества</Link>
    <div className="page-heading"><div><h1>Создать сообщество</h1><p>Объединяй людей вокруг общих интересов.</p></div></div>
    <CommunityForm />
  </div>;
}
