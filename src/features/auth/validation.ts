import type { AuthActionState } from "@/features/auth/types";

export function validateAuthInput(formData: FormData, register: boolean) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const fieldErrors: NonNullable<AuthActionState["fieldErrors"]> = {};
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Укажите корректный email.";
  }
  if (!password || password.length > 128 || (register && password.length < 8)) {
    fieldErrors.password = register
      ? "Пароль должен содержать от 8 до 128 символов."
      : "Введите пароль (до 128 символов).";
  }
  if (register && (!firstName || firstName.length > 60)) {
    fieldErrors.first_name = "Укажите имя: от 1 до 60 символов.";
  }
  if (register && (!lastName || lastName.length > 60)) {
    fieldErrors.last_name = "Укажите фамилию: от 1 до 60 символов.";
  }
  return {
    email,
    password,
    firstName,
    lastName,
    fieldErrors,
    valid: Object.keys(fieldErrors).length === 0,
  };
}
