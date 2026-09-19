import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSupabaseConfig } from "@/lib/env";
import { AuthForm } from "@/features/auth/auth-form";
import { Notice } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Вход" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = safeNextPath(query.next);
  if (await getCurrentUser()) redirect(next);
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">СНОВА ВМЕСТЕ</p>
        <h1>С возвращением.</h1>
        <p className="muted">Войди, чтобы быть в курсе жизни колледжа.</p>
      </div>
      {query.error === "confirmation_failed" && (
        <Notice tone="error">
          Ссылка подтверждения недействительна или уже использована. Попробуйте
          войти; если email ещё не подтверждён, запросите новое письмо через
          регистрацию.
        </Notice>
      )}
      {query.notice === "signed_out" && (
        <Notice tone="success">Вы вышли из аккаунта на этом устройстве.</Notice>
      )}
      <AuthForm
        mode="login"
        next={next}
        configured={Boolean(getSupabaseConfig())}
      />
      <p className="auth-switch muted">
        Ещё нет аккаунта? <Link href="/register">Присоединиться</Link>
      </p>
    </>
  );
}
