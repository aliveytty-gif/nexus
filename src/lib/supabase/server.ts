import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";

/** A new client per request keeps one visitor's session out of another's. */
export async function createClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase is not configured. See /setup.");

  const cookieStore = await cookies();
  return createServerClient<Database>(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. proxy.ts refreshes them.
          // Server Actions and Route Handlers can write through this adapter.
        }
      },
    },
  });
}
