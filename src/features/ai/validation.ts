export type AiMessage = { role: "user" | "assistant"; content: string };
export class AiError extends Error {
  code: string;
  status: number;
  retryAfter?: number;
  constructor(code: string, message: string, status = 503, retryAfter?: number) {
    super(message); this.code = code; this.status = status; this.retryAfter = retryAfter;
  }
}

export function validateChat(value: unknown): AiMessage[] {
  if (!value || typeof value !== "object") throw new AiError("invalid_request", "Проверь текст сообщения.", 400);
  const input = value as Record<string, unknown>;
  if (input.consent !== true) throw new AiError("consent_required", "Подтверди передачу текста внешней AI-модели.", 400);
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 7 || input.messages.length % 2 !== 1)
    throw new AiError("invalid_context", "Слишком длинный диалог. Начни новый.", 400);
  let total = 0;
  return input.messages.map((item: unknown, index: number) => {
    if (!item || typeof item !== "object") throw new AiError("invalid_context", "Проверь сообщения диалога.", 400);
    const message = item as Record<string, unknown>;
    if (message.role !== (index % 2 === 0 ? "user" : "assistant") || typeof message.content !== "string" ||
      !message.content.trim() || message.content.length > 4000)
      throw new AiError("invalid_context", "Сообщение должно содержать от 1 до 4000 символов.", 400);
    total += message.content.length;
    if (total > 12000) throw new AiError("invalid_context", "Контекст слишком длинный. Начни новый диалог.", 400);
    return { role: message.role as AiMessage["role"], content: message.content };
  });
}

export async function boundedJson(source: Request | Response, limit: number): Promise<unknown> {
  if (Number(source.headers.get("content-length") || 0) > limit)
    throw new AiError("too_large", "Слишком большой запрос или ответ.", 413);
  const reader = source.body?.getReader();
  if (!reader) throw new AiError("invalid_json", "Не удалось прочитать сообщение.", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new AiError("too_large", "Слишком большой запрос или ответ.", 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new AiError("invalid_json", "Не удалось прочитать сообщение.", 400); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function freeModelId(id: string) {
  return id === "openrouter/free" || /^[a-z0-9._-]+\/[a-z0-9._-]+:free$/.test(id);
}
