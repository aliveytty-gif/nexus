import "server-only";
import { createHmac } from "node:crypto";
import { AiError, boundedJson, type AiMessage } from "./validation.ts";

const SPACE_ORIGIN = "https://aliveytty-nexus.hf.space";
const CHAT_URL = `${SPACE_ORIGIN}/gradio_api/call/chat`;
const SYSTEM_PROMPT = "Ты NEXUS AI, помощник студентов. Отвечай кратко по-русски. Используй Markdown, когда он помогает. Помогай с учёбой, кодом и текстами. Не выдумывай факты о колледже и не утверждай, что видишь личные данные или можешь выполнять действия в NEXUS.";
const MAX_INPUT_BYTES = 4200;
const MAX_REPLY_BYTES = 16 * 1024;
const MAX_EVENT_CHARS = 64 * 1024;
const MAX_STREAM_BYTES = 1024 * 1024;
const STOP_TIMEOUT_MS = 4000;
export const ZERO_GPU_MAX_OUTPUT_TOKENS = 128;

type ZeroGpuMessage = AiMessage | { role: "system"; content: string };
export type ZeroGpuEvent = { type: "delta"; text: string } | { type: "done" } | { type: "stopped"; confirmed: true };

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

export function parseZeroGpuRequestId(body: unknown): string {
  const requestId = body && typeof body === "object" ? (body as { requestId?: unknown }).requestId : undefined;
  if (!isRequestId(requestId)) throw new AiError("invalid_request", "Обнови страницу и отправь запрос ещё раз.", 400);
  return requestId;
}

export function zeroGpuOperationId(token: string, userId: string, clientRequestId: string): string {
  const digest = createHmac("sha256", token)
    .update(JSON.stringify(["nexus-zerogpu-operation", userId, clientRequestId]))
    .digest().subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const id = digest.toString("hex");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function contextLimit() {
  return new AiError("invalid_context", "Сократи последнее сообщение или начни новый диалог.", 400);
}

export function zeroGpuMessages(messages: readonly AiMessage[]): ZeroGpuMessage[] {
  // validateChat provides a user-led alternating history ending in a user message.
  const system: ZeroGpuMessage = { role: "system", content: SYSTEM_PROMPT };
  const turns = messages.map(({ role, content }) => ({ role, content }));
  for (let start = 0; start < turns.length; start += 2) {
    const candidate = [system, ...turns.slice(start)];
    if (Buffer.byteLength(JSON.stringify(candidate)) <= MAX_INPUT_BYTES) return candidate;
  }
  throw contextLimit();
}

function providerInvalid() {
  return new AiError("provider_invalid", "Не удалось прочитать ответ модели. Попробуй позже.");
}

function providerLimit() {
  return new AiError("provider_limit", "Бесплатный лимит ZeroGPU исчерпан. Попробуй позже.", 429, 60);
}

function providerTimeout() {
  return new AiError("provider_timeout", "Модель не успела ответить. Попробуй позже.", 504);
}

function providerUnavailable() {
  return new AiError("provider_unavailable", "Модель временно недоступна. Попробуй позже.");
}

function fetchOptions(token: string, signal: AbortSignal): RequestInit {
  return { cache: "no-store", redirect: "error", signal, headers: { Authorization: `Bearer ${token}` } };
}

function requireSuccessfulResponse(response: Response) {
  if (response.ok) return;
  void response.body?.cancel().catch(() => {});
  if (response.status === 401 || response.status === 403)
    throw new AiError("provider_auth", "AI временно недоступен. Требуется проверка настроек провайдера.");
  if (response.status === 402 || response.status === 429) throw providerLimit();
  if (response.status === 408 || response.status === 504) throw providerTimeout();
  throw providerUnavailable();
}

export async function stopZeroGpuReply(token: string, operationId: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!token || !isRequestId(operationId)) return false;
  const signal = AbortSignal.timeout(STOP_TIMEOUT_MS);
  try {
    const response = await fetcher(`${SPACE_ORIGIN}/stop/${operationId}`, { ...fetchOptions(token, signal), method: "POST" });
    requireSuccessfulResponse(response);
    const body = await boundedJson(response, 1024) as { stopped?: unknown } | null;
    return body?.stopped === true;
  } catch {
    return false;
  }
}

async function* readSpaceEvents(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let frameChars = 0;
  let event = "";
  let data: string[] = [];
  let line = "";
  let skipLineFeed = false;
  while (true) {
    const { done, value } = await reader.read();
    signal.throwIfAborted();
    if (done) {
      decoder.decode();
      return;
    }
    bytes += value.byteLength;
    if (bytes > MAX_STREAM_BYTES) throw providerInvalid();
    const chunk = decoder.decode(value, { stream: true });
    if (!chunk) continue;
    const offset: number = skipLineFeed && chunk.startsWith("\n") ? 1 : 0;
    let cursor = offset;
    skipLineFeed = false;
    for (const match of chunk.slice(offset).matchAll(/\r\n|[\r\n]/g)) {
      const end = offset + match.index;
      line += chunk.slice(cursor, end);
      cursor = end + match[0].length;
      skipLineFeed = match[0] === "\r" && cursor === chunk.length;
      frameChars += line.length + 1;
      if (frameChars > MAX_EVENT_CHARS) throw providerInvalid();
      if (!line) {
        if (event) yield { event, data: data.join("\n") };
        frameChars = 0;
        event = "";
        data = [];
      } else if (line.startsWith("event:")) {
        event = line.slice(6).trimStart();
      } else if (line.startsWith("data:")) {
        const field = line.slice(5);
        data.push(field.startsWith(" ") ? field.slice(1) : field);
      }
      line = "";
    }
    line += chunk.slice(cursor);
    if (frameChars + line.length > MAX_EVENT_CHARS) throw providerInvalid();
  }
}

function spaceEventError(data: string) {
  // Classify known upstream markers without returning the payload or error text.
  if (/\bNEXUS_CONTEXT_LIMIT\b/.test(data)) return contextLimit();
  if (/\bNEXUS_INVALID_REQUEST\b/.test(data)) return new AiError("invalid_request", "Проверь текст сообщения.", 400);
  if (/\bNEXUS_DUPLICATE_REQUEST\b/.test(data)) return new AiError("busy", "Этот запрос уже выполняется. Подожди немного.", 429, 10);
  if (/\b(?:GPU|ZeroGPU)\s+quota\b/i.test(data)) return providerLimit();
  return providerUnavailable();
}

function parseReply(data: string): [string, "streaming" | "done" | "stopped"] {
  let payload: unknown;
  try { payload = JSON.parse(data); } catch { throw providerInvalid(); }
  if (!Array.isArray(payload) || payload.length !== 2) throw providerInvalid();
  const [text, phase] = payload;
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_REPLY_BYTES ||
    (phase !== "streaming" && phase !== "done" && phase !== "stopped")) throw providerInvalid();
  return [text, phase];
}

export async function* streamZeroGpuReply({
  token, operationId, messages, maxTokens, signal, fetcher = fetch,
}: {
  token: string;
  operationId: string;
  messages: readonly ZeroGpuMessage[];
  maxTokens: number;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}): AsyncGenerator<ZeroGpuEvent> {
  if (!token || !isRequestId(operationId) || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > ZERO_GPU_MAX_OUTPUT_TOKENS)
    throw new AiError("not_configured", "NEXUS AI пока не подключён. Попробуй позже.");
  const serializedMessages = JSON.stringify(messages);
  if (Buffer.byteLength(serializedMessages) > MAX_INPUT_BYTES) throw contextLimit();

  const options = fetchOptions(token, signal);
  let submitted = false;
  let complete = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    signal.throwIfAborted();
    // The remote queue may receive the POST even if our fetch rejects on abort.
    submitted = true;
    const submission = await fetcher(CHAT_URL, {
      ...options, method: "POST", headers: { ...options.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ data: [operationId, serializedMessages, maxTokens] }),
    });
    requireSuccessfulResponse(submission);
    const submissionBody = await boundedJson(submission, 2048).catch(() => { throw providerInvalid(); }) as { event_id?: unknown } | null;
    const eventId = submissionBody?.event_id;
    if (typeof eventId !== "string" || !eventId.length || eventId.length > 128 || /[^a-zA-Z0-9_-]/.test(eventId))
      throw providerInvalid();
    signal.throwIfAborted();
    const response = await fetcher(`${CHAT_URL}/${eventId}`, { ...options, method: "GET" });
    requireSuccessfulResponse(response);
    reader = response.body?.getReader();
    if (!reader || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/event-stream")
      throw providerInvalid();

    let prefix = "";
    for await (const frame of readSpaceEvents(reader, signal)) {
      signal.throwIfAborted();
      if (frame.event === "error") throw spaceEventError(frame.data);
      if (frame.event !== "generating" && frame.event !== "complete") continue;
      const [text, phase] = parseReply(frame.data);
      if (!text.startsWith(prefix) || (frame.event === "complete" && phase === "streaming")) throw providerInvalid();
      const delta = text.slice(prefix.length);
      prefix = text;
      if (frame.event === "complete") {
        if (phase === "done" && !text.trim()) throw providerInvalid();
        complete = true;
      }
      if (delta) yield { type: "delta", text: delta };
      if (complete) {
        yield phase === "stopped" ? { type: "stopped", confirmed: true } : { type: "done" };
        return;
      }
    }
    throw providerUnavailable();
  } catch (error) {
    if (signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) throw providerTimeout();
    if (error instanceof AiError) throw error;
    throw providerUnavailable();
  } finally {
    if (submitted && !complete) await stopZeroGpuReply(token, operationId, fetcher);
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
