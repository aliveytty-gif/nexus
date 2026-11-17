import type { AgentEvent } from "./contracts.ts";

export async function consumeAgentStream(response: Response, onEvent: (event: AgentEvent) => void) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error || "Не удалось отправить вопрос.");
  }
  if (!response.headers.get("content-type")?.startsWith("application/x-ndjson") || !response.body) throw new Error("Не удалось прочитать поток ответа.");
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ""; let bytes = 0; let terminal = false;
  const line = (value: string) => {
    if (!value.trim()) return;
    const event = JSON.parse(value) as AgentEvent;
    if (event.type === "done" || event.type === "error") terminal = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); if (buffer.trim()) line(buffer); break; }
      bytes += value.length;
      if (bytes > 1024 * 1024) throw new Error("Слишком большой поток ответа.");
      buffer += decoder.decode(value, { stream: true });
      let position: number;
      while ((position = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, position)); buffer = buffer.slice(position + 1); }
      if (buffer.length > 200000) throw new Error("Повреждённый поток ответа.");
    }
    if (!terminal) throw new TypeError("Связь прервалась до подтверждения сохранения. Проверь результат повтором.");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
