"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowRight } from "lucide-react";
import { loginAction, registerAction } from "@/features/auth/actions";
import type { AuthActionState } from "@/features/auth/types";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";

export function AuthForm({
  mode,
  next = "/feed",
  configured,
}: {
  mode: "login" | "register";
  next?: string;
  configured: boolean;
}) {
  const register = mode === "register";
  const [state, action, pending] = useActionState<AuthActionState, FormData>(
    register ? registerAction : loginAction,
    {},
  );
  const [fields, setFields] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
  });
  const update = (field: keyof typeof fields, value: string) =>
    setFields((old) => ({ ...old, [field]: value }));
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="form-stack" aria-busy={pending}>
      <input type="hidden" name="next" value={next} />
      {!configured && (
        <Notice tone="info">
          Подключите Supabase, чтобы пользоваться аккаунтами.{" "}
          <Link href="/setup">Инструкция по настройке →</Link>
        </Notice>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.message && <Notice tone="success">{state.message}</Notice>}
      {register && (
        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor="first_name">
              Имя
            </label>
            <input
              id="first_name"
              name="first_name"
              className="input"
              autoComplete="given-name"
              required
              maxLength={60}
              value={fields.first_name}
              onChange={(e) => update("first_name", e.target.value)}
              aria-invalid={Boolean(errors.first_name)}
              aria-describedby={
                errors.first_name ? "first-name-error" : undefined
              }
            />
            {errors.first_name && (
              <p className="error-text" id="first-name-error">
                {errors.first_name}
              </p>
            )}
          </div>
          <div className="field">
            <label className="label" htmlFor="last_name">
              Фамилия
            </label>
            <input
              id="last_name"
              name="last_name"
              className="input"
              autoComplete="family-name"
              required
              maxLength={60}
              value={fields.last_name}
              onChange={(e) => update("last_name", e.target.value)}
              aria-invalid={Boolean(errors.last_name)}
              aria-describedby={
                errors.last_name ? "last-name-error" : undefined
              }
            />
            {errors.last_name && (
              <p className="error-text" id="last-name-error">
                {errors.last_name}
              </p>
            )}
          </div>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          placeholder="you@example.com"
          autoComplete="email"
          required
          maxLength={254}
          value={fields.email}
          onChange={(e) => update("email", e.target.value)}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "email-error" : undefined}
        />
        {errors.email && (
          <p className="error-text" id="email-error">
            {errors.email}
          </p>
        )}
      </div>
      <div className="field">
        <label className="label" htmlFor="password">
          Пароль
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          placeholder={register ? "Не менее 8 символов" : "Ваш пароль"}
          autoComplete={register ? "new-password" : "current-password"}
          required
          minLength={register ? 8 : undefined}
          maxLength={128}
          value={fields.password}
          onChange={(e) => update("password", e.target.value)}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "password-error" : undefined}
        />
        {errors.password && (
          <p className="error-text" id="password-error">
            {errors.password}
          </p>
        )}
      </div>
      <fieldset disabled={!configured} className="auth-submit">
        <SubmitButton
          pendingText={register ? "Создаём аккаунт…" : "Входим…"}
          className="button button-primary"
        >
          {register ? "Создать аккаунт" : "Войти в NEXUS"}
          <ArrowRight size={18} aria-hidden="true" />
        </SubmitButton>
      </fieldset>
    </form>
  );
}
