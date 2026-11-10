import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseConfig } from "@/lib/env";
import { isRecoveryEnabled } from "@/features/auth/recovery";
import { requestRecoveryAction } from "@/features/auth/recovery-actions";
import { RecoveryForm } from "@/features/auth/recovery-form";

export const metadata: Metadata = { title: "Восстановление пароля" };

export default function ForgotPasswordPage() {
  if (!isRecoveryEnabled() || !getSupabaseConfig()) notFound();

  return (
    <>
      <div className="page-heading">
        <h1>Восстановление пароля</h1>
        <p className="muted">Укажите email, с которым регистрировались в NEXUS.</p>
      </div>
      <RecoveryForm submit={requestRecoveryAction} />
      <p className="auth-switch"><Link href="/login">Вернуться ко входу</Link></p>
    </>
  );
}
