import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Notice } from "@/components/ui/notice";
import { getSupabaseConfig } from "@/lib/env";
import {
  isRecoveryEnabled,
  isRecoveryToken,
  recoveryCookie,
  recoveryFormId,
} from "@/features/auth/recovery";
import { resetPasswordAction } from "@/features/auth/recovery-actions";
import { RecoveryForm } from "@/features/auth/recovery-form";

export const metadata: Metadata = { title: "Новый пароль" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isRecoveryEnabled() || !getSupabaseConfig()) notFound();

  const query = await searchParams;
  const token = (await cookies()).get(recoveryCookie)?.value;
  const updated = query.notice === "updated";
  const canReset = !updated && !query.error && isRecoveryToken(token);

  return (
    <>
      <div className="page-heading"><h1>Новый пароль</h1></div>
      {updated ? (
        <Notice tone="success">Пароль изменён. Теперь можно войти с новым паролем.</Notice>
      ) : canReset ? (
        <RecoveryForm reset submit={resetPasswordAction.bind(null, recoveryFormId(token))} />
      ) : (
        <>
          <Notice tone="error">
            {query.error === "password_rejected"
              ? "Не удалось сохранить пароль. Запросите новую ссылку и выберите другой пароль."
              : "Ссылка недействительна, истекла или уже использована."}
          </Notice>
          <p className="auth-switch">
            <Link href="/forgot-password">Запросить новую ссылку</Link>
          </p>
        </>
      )}
      <p className="auth-switch"><Link href="/login">Вернуться ко входу</Link></p>
    </>
  );
}
