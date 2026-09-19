/** Strict allowlist: no external origins, encoded paths, slashes or query tricks. */
export function safeNextPath(value: unknown, fallback = "/feed"): string {
  if (typeof value !== "string" || value.length > 150) return fallback;
  const allowed =
    /^\/(?:feed|messages|map|college-map|ai|nexus-ai|profile\/edit|profile\/[a-z0-9_]{3,40}|posts\/[0-9a-f-]{36})\/?$/;
  return allowed.test(value) ? value : fallback;
}
