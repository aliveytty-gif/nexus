import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSupabaseConfig } from "@/lib/env";
import { authRedirect } from "@/lib/auth/redirect-response";

export async function GET(request: NextRequest) {
  if (!getSupabaseConfig()) return authRedirect("/setup");
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return authRedirect(
        safeNextPath(request.nextUrl.searchParams.get("next"), "/profile/edit"),
      );
    }
  }
  return authRedirect("/login?error=confirmation_failed");
}
