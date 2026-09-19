import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { getSupabaseConfig } from "@/lib/env";
import { AuthForm } from "@/features/auth/auth-form";

export const metadata: Metadata = { title: "Регистрация" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/profile/edit");
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">ТВОЯ ТОЧКА ВХОДА</p>
        <h1>Здесь свои.</h1>
        <p className="muted">Создай аккаунт и найди тех, с кем тебе по пути.</p>
      </div>
      <AuthForm mode="register" configured={Boolean(getSupabaseConfig())} />
      <p className="auth-switch muted">
        Уже с нами? <Link href="/login">Войти</Link>
      </p>
    </>
  );
}
