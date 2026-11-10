import { createHash } from "node:crypto";
import { createClient, isAuthRetryableFetchError } from "@supabase/supabase-js";

type Config = { url: string; key: string };

export const recoveryCookie = "nexus-password-recovery";
export const recoveryCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/reset-password",
  maxAge: 600,
} as const;

export function isRecoveryEnabled() {
  return process.env.AUTH_PASSWORD_RECOVERY_ENABLED === "true";
}

export function isRecoveryToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{32,128}$/.test(value);
}

export function recoveryFormId(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createRecoveryClient({ url, key }: Config) {
  // Keep the verified recovery session in memory, separate from browser cookies.
  return createClient(url, key, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function sendRecoveryEmail(
  config: Config,
  email: string,
  siteUrl: string,
) {
  const supabase = createRecoveryClient(config);
  // Return the same public response even when Supabase rejects the request.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL("/auth/recovery", siteUrl).href,
  });
  return {
    message:
      "Если для этого email доступно восстановление, придёт письмо со ссылкой. Проверьте также папку «Спам».",
  };
}

export async function applyRecoveryPassword(
  config: Config,
  token: string,
  password: string,
) {
  const supabase = createRecoveryClient(config);
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: token,
    type: "recovery",
  });

  if (
    isAuthRetryableFetchError(error) ||
    error?.status === 429 ||
    (error?.status ?? 0) >= 500
  )
    return "retry" as const;
  if (error || !data.session || !data.user) return "invalid_link" as const;

  try {
    const { error: updateError } = await supabase.auth.updateUser({ password });
    return updateError ? ("password_rejected" as const) : ("updated" as const);
  } finally {
    // Best-effort revocation of the temporary session. It never leaves the server.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}
