export type NdjsonEvent =
  | { type: "meta"; userRemaining: number; globalRemaining: number }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; code: string; error: string };

function eventFrom(line: string): NdjsonEvent {
  const invalid = () => new Error("Некорректный поток ответа AI.");
  let event: unknown;
  try { event = JSON.parse(line); } catch { throw invalid(); }
  if (!event || typeof event !== "object" || Array.isArray(event)) throw invalid();
  const value = event as Record<string, unknown>;
  if (value.type === "done") return { type: "done" };
  if (value.type === "delta" && typeof value.text === "string" && value.text.length <= 16000)
    return { type: "delta", text: value.text };
  if (value.type === "error" && typeof value.code === "string" && /^[a-z_]{1,64}$/.test(value.code) &&
    typeof value.error === "string" && value.error.length <= 512)
    return { type: "error", code: value.code, error: value.error };
  if (value.type === "meta" && [value.userRemaining, value.globalRemaining].every((n) =>
    typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100000))
    return { type: "meta", userRemaining: value.userRemaining as number, globalRemaining: value.globalRemaining as number };
  throw invalid();
}

/** Leaving this bounded UTF-8 generator cancels the underlying response. */
export async function* readNdjson(stream: ReadableStream<Uint8Array>): AsyncGenerator<NdjsonEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "", bytes = 0, output = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        bytes += value.byteLength;
        if (bytes > 131072) throw new Error("Ответ AI слишком большой.");
      }
      try { pending += decoder.decode(value, { stream: !done }); }
      catch { throw new Error("Некорректная кодировка ответа AI."); }
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0 || (done && pending.length > 0)) {
        const rawLine = newline >= 0 ? pending.slice(0, newline) : pending;
        if (rawLine.length > 32768) throw new Error("Строка ответа AI слишком большая.");
        const line = rawLine.trim();
        pending = newline >= 0 ? pending.slice(newline + 1) : "";
        if (!line) continue;
        const event = eventFrom(line);
        if (event.type === "delta") {
          output += event.text.length;
          if (output > 16000) throw new Error("Ответ AI слишком большой.");
        }
        yield event;
        if (event.type === "done" || event.type === "error") return;
      }
      if (pending.length > 32768) throw new Error("Строка ответа AI слишком большая.");
      if (done) throw new Error("Соединение с AI прервано до завершения ответа.");
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
