"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getProfileById } from "@/features/profiles/data";
import { validateProfileInput } from "@/features/profiles/validation";
import type { ProfileActionState } from "@/features/profiles/types";

export async function updateProfileAction(
  _previous: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser("/profile/edit");
  const input = validateProfileInput(formData);
  if (!input.valid)
    return {
      error: "Проверьте заполненные поля.",
      fieldErrors: input.fieldErrors,
    };
  if (
    /^u_[0-9a-f]{32}$/.test(input.values.p_username) &&
    input.values.p_username !== `u_${user.id.replaceAll("-", "")}`
  ) {
    return {
      error: "Этот username зарезервирован системой.",
      fieldErrors: {
        username:
          "Выберите имя без шаблона u_ и 32 шестнадцатеричных символов.",
      },
    };
  }
  const oldProfile = await getProfileById(user.id);
  if (!oldProfile)
    return {
      error:
        "Профиль не найден. Проверьте, что миграции применены до регистрации аккаунта.",
    };
  const supabase = await createClient();
  // auth.uid() inside the RPC selects the owner. No client-submitted profile ID.
  // Profile fields and interests commit in one transaction or roll back together.
  const { error } = await supabase.rpc("update_my_profile", input.values);
  if (error) {
    if (error.code === "23505")
      return {
        error: "Этот username уже занят.",
        fieldErrors: { username: "Выберите другой username." },
      };
    if (error.code === "23503" || error.code === "22023")
      return {
        error:
          "Список интересов изменился. Обновите страницу и выберите интересы ещё раз.",
      };
    return { error: "Не удалось сохранить профиль. Повторите попытку позже." };
  }
  revalidatePath("/", "layout");
  revalidatePath(`/profile/${oldProfile.username}`);
  revalidatePath(`/profile/${input.values.p_username}`);
  redirect(`/profile/${input.values.p_username}?saved=1`);
}
