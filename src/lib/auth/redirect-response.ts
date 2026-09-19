import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/env";

/** Do not cache confirmation responses or forward a one-time token as a referrer. */
export function authRedirect(path: string) {
  return NextResponse.redirect(new URL(path, getSiteUrl()), {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
