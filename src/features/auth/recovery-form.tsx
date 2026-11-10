"use client";

import { useActionState } from "react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import type { AuthActionState } from "@/features/auth/types";

export function RecoveryForm({
  reset = false,
  submit,
}: {
  reset?: boolean;
  submit: (previous: AuthActionState, data: FormData) => Promise<AuthActionState>;
}) {
  const [state, action, pending] = useActionState(submit, {});

  return (
    <form action={action} className="form-stack" aria-busy={pending}>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.message ? (
        <Notice tone="success">{state.message}</Notice>
      ) : (
        <>
          {reset ? (
            <>
              <div className="field">
                <label className="label" htmlFor="password">Новый пароль</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="password_confirmation">
                  Повторите новый пароль
                </label>
                <input
                  id="password_confirmation"
                  name="password_confirmation"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </div>
            </>
          ) : (
            <div className="field">
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                className="input"
                maxLength={254}
                required
              />
            </div>
          )}
          <div className="auth-submit">
            <SubmitButton
              pendingText={reset ? "Сохраняем…" : "Отправляем…"}
              className="button button-primary"
            >
              {reset ? "Сохранить пароль" : "Отправить ссылку"}
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
