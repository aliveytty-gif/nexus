export function displayName(profile: {
  first_name: string;
  last_name: string;
  username: string;
}) {
  return (
    `${profile.first_name} ${profile.last_name}`.trim() ||
    `@${profile.username}`
  );
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}
export function formatJoined(value: string) {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === "month")!.value} ${parts.find((part) => part.type === "year")!.value} г.`;
}
export function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 && n <= 10000 ? n : 1;
}
