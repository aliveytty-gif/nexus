export const POST_LIMIT = 5000;
export const COMMENT_LIMIT = 2000;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateContent(
  value: FormDataEntryValue | null,
  max: number,
): { content: string; error?: string } {
  if (typeof value !== "string")
    return { content: "", error: "Напишите текст." };
  const content = value.trim();
  if (!content)
    return {
      content,
      error: "Напишите текст: публикация не может быть пустой.",
    };
  if (content.length > max)
    return { content, error: `Максимальная длина — ${max} символов.` };
  return { content };
}
