"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSiteUrl, getSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { validateAuthInput } from "@/features/auth/validation";
import type { AuthActionState } from "@/features/auth/types";

export async function loginAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!getSupabaseConfig())
    return { error: "Сначала подключите Supabase на странице настройки." };
  const input = validateAuthInput(formData, false);
  if (!input.valid)
    return {
      error: "Проверьте заполненные поля.",
      fieldErrors: input.fieldErrors,
    };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (error) {
    if (error.code === "email_not_confirmed")
      return { error: "Подтвердите email по ссылке из письма, затем войдите." };
    if (error.status === 429)
      return {
        error: "Слишком много попыток. Подождите немного и повторите вход.",
      };
    return {
      error:
        "Не удалось войти. Проверьте email и пароль или повторите попытку позже.",
    };
  }
  revalidatePath("/", "layout");
  redirect(safeNextPath(formData.get("next")));
}

export async function registerAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!getSupabaseConfig())
    return { error: "Сначала подключите Supabase на странице настройки." };
  const input = validateAuthInput(formData, true);
  if (!input.valid)
    return {
      error: "Проверьте заполненные поля.",
      fieldErrors: input.fieldErrors,
    };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { first_name: input.firstName, last_name: input.lastName },
      emailRedirectTo: `${getSiteUrl()}/auth/callback?next=/profile/edit`,
    },
  });
  if (error) {
    if (error.code === "weak_password")
      return {
        error: "Supabase отклонил пароль: выберите более сложный пароль.",
      };
    if (error.status === 429)
      return {
        error: "Лимит регистраций или писем исчерпан. Повторите попытку позже.",
      };
    return {
      error:
        "Не удалось зарегистрироваться. Проверьте данные и повторите попытку позже.",
    };
  }
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/profile/edit");
  }
  // Supabase intentionally hides whether an email already has an account.
  return {
    message:
      "Если этот email доступен для регистрации, на него отправлена ссылка подтверждения. Проверьте почту и папку «Спам». Если аккаунт уже есть — войдите.",
  };
}

export async function logoutAction() {
  if (getSupabaseConfig()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) redirect("/feed?error=logout_failed");
  }
  revalidatePath("/", "layout");
  redirect("/login?notice=signed_out");
}
