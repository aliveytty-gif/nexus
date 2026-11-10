"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSiteUrl, getSupabaseConfig } from "@/lib/env";
import type { AuthActionState } from "@/features/auth/types";
import {
  readAuthEmail,
  validateRecoveryPassword,
} from "@/features/auth/validation";
import {
  applyRecoveryPassword,
  isRecoveryEnabled,
  isRecoveryToken,
  recoveryCookie,
  recoveryCookieOptions,
  recoveryFormId,
  sendRecoveryEmail,
} from "@/features/auth/recovery";

export async function requestRecoveryAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const config = getSupabaseConfig();
  if (!config || !isRecoveryEnabled())
    return { error: "Восстановление пароля пока недоступно." };

  const { email, valid } = readAuthEmail(formData);
  if (!valid) return { error: "Укажите корректный email." };

  return sendRecoveryEmail(config, email, getSiteUrl());
}

export async function resetPasswordAction(
  formId: string,
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const config = getSupabaseConfig();
  if (!config || !isRecoveryEnabled())
    return { error: "Восстановление пароля пока недоступно." };

  const cookieStore = await cookies();
  const token = cookieStore.get(recoveryCookie)?.value;
  // A form opened earlier must not apply its password to a newer email link.
  if (!isRecoveryToken(token) || formId !== recoveryFormId(token))
    redirect("/reset-password?error=invalid_link");

  const input = validateRecoveryPassword(formData);
  if ("error" in input) return input;

  const result = await applyRecoveryPassword(config, token, input.password);
  if (result === "retry")
    return { error: "Сервис временно недоступен. Повторите попытку чуть позже." };

  cookieStore.set(recoveryCookie, "", {
    ...recoveryCookieOptions,
    secure: getSiteUrl().startsWith("https:"),
    maxAge: 0,
  });
  if (result === "updated") redirect("/reset-password?notice=updated");
  redirect(`/reset-password?error=${result}`);
}
