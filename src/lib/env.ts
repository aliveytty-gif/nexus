export function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !key || url.includes("your-project") || key.includes("your-"))
    return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname)
      )
    )
      return null;
    return { url: parsed.origin, key };
  } catch {
    return null;
  }
}

export function getSiteUrl(): string {
  const hostedOnVercel = process.env.VERCEL === "1";
  const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const value =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (productionDomain ? `https://${productionDomain}` : "http://localhost:3000");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("NEXT_PUBLIC_SITE_URL must be an http(s) URL");
  if (
    hostedOnVercel &&
    (url.protocol !== "https:" ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") ||
      url.hostname.startsWith("127.") ||
      ["0.0.0.0", "[::1]"].includes(url.hostname))
  )
    throw new Error("NEXT_PUBLIC_SITE_URL must be a public HTTPS URL on Vercel");
  return url.origin;
}
