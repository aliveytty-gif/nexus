import type { NextRequest } from "next/server";
import { authRedirect } from "@/lib/auth/redirect-response";
import { getSiteUrl, getSupabaseConfig } from "@/lib/env";
import {
  isRecoveryEnabled,
  isRecoveryToken,
  recoveryCookie,
  recoveryCookieOptions,
} from "@/features/auth/recovery";

export function GET(request: NextRequest) {
  if (!isRecoveryEnabled() || !getSupabaseConfig()) return authRedirect("/login");

  const tokens = request.nextUrl.searchParams.getAll("token_hash");
  if (tokens.length !== 1 || !isRecoveryToken(tokens[0]))
    return authRedirect("/reset-password?error=invalid_link");

  // Link previews can follow the redirect without consuming the token.
  const response = authRedirect("/reset-password");
  response.cookies.set(recoveryCookie, tokens[0], {
    ...recoveryCookieOptions,
    secure: getSiteUrl().startsWith("https:"),
  });
  return response;
}
