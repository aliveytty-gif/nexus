import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSupabaseConfig } from "@/lib/env";
import { authRedirect } from "@/lib/auth/redirect-response";

export async function GET(request: NextRequest) {
  if (!getSupabaseConfig()) return authRedirect("/setup");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  // This route only handles confirmation; password recovery is a future flow.
  if (tokenHash && (type === "email" || type === "signup")) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      return authRedirect(
        safeNextPath(request.nextUrl.searchParams.get("next"), "/profile/edit"),
      );
    }
  }
  return authRedirect("/login?error=confirmation_failed");
}
