import "server-only";
import type { AiConfig } from "./config.ts";
import { AiError, boundedJson, freeModelId, type AiMessage } from "./validation.ts";

import { systemPrompt } from "./persona.ts";
import { readNdjson } from "./stream.ts";

type ProviderMessage = { role: "system" | "user" | "assistant"; content: string };
export function providerMessages(config: AiConfig, messages: AiMessage[]): ProviderMessage[] {
  if (config.systemInstructions.length > 2000)
    throw new AiError("not_configured", "Системные инструкции AI превышают допустимый размер.");
  const system: ProviderMessage = { role: "system", content: systemPrompt(config.systemInstructions) };
  const history = [...messages];
  const bytes = (items: ProviderMessage[]) => items.reduce((sum, item) => sum + new TextEncoder().encode(item.content).length, 0);
  while (history.length > 1 && bytes([system, ...history]) + config.maxOutputTokens + 512 > 16384) history.splice(0, 2);
  if (system.content.length > 4000 || bytes([system, ...history]) + config.maxOutputTokens + 512 > 16384)
    throw new AiError("invalid_context", "Сообщение слишком длинное для модели. Сократи его и попробуй снова.", 400);
  return [system, ...history];
}

type CatalogModel = { id: string; pricing?: Record<string, string | number> };
export function selectFreeModels(catalog: unknown, preferred: string, fallback: string): string[] {
  if (!catalog || typeof catalog !== "object" || !Array.isArray((catalog as { data?: unknown }).data)) return [];
  const models = (catalog as { data: CatalogModel[] }).data;
  return [...new Set([preferred, fallback])].filter((id) => {
    if (!freeModelId(id)) return false;
    const model = models.find((item) => item?.id === id);
    const pricing = model?.pricing;
    return pricing && pricing.prompt !== undefined && pricing.completion !== undefined &&
      Object.values(pricing).every((price) =>
        (typeof price === "number" || (typeof price === "string" && price.trim() !== "")) &&
        Number.isFinite(Number(price)) && Number(price) === 0);
  });
}

export async function availableModels(config: AiConfig, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  if (config.provider === "ollama") {
    if (!config.ready || !config.gatewayUrl) throw new AiError("not_configured", "Сервер модели пока не подключён.");
    return [config.model];
  }
  if (!freeModelId(config.model) || !freeModelId(config.fallbackModel))
    throw new AiError("paid_model_blocked", "В конфигурации разрешены только бесплатные модели.");
  try {
    // Only this public catalogue is cached; prompts/responses never enter a shared cache.
    const response = await fetcher("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.any([AbortSignal.timeout(6000), ...(signal ? [signal] : [])]),
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error("catalogue unavailable");
    const models = selectFreeModels(await boundedJson(response, 3000000), config.model, config.fallbackModel);
    if (!models.length) throw new Error("no free model");
    return models;
  } catch { throw new AiError("no_free_model", "Бесплатные модели сейчас недоступны. Попробуй позже."); }
}

function providerError(code: string): AiError {
  switch (code) {
    case "busy": case "gateway_busy": return new AiError("gateway_busy", "Сервер AI занят. Попробуй через минуту.", 429, 5);
    case "model_unavailable": return new AiError("model_unavailable", "Модель пока не готова. Попробуй позже.");
    case "timeout": case "provider_timeout": return new AiError("provider_timeout", "Модель не успела ответить. Попробуй позже.", 504);
    case "invalid_request": case "invalid_context": return new AiError("invalid_context", "Сообщение слишком длинное для модели. Сократи его.", 400);
    case "invalid_response": return new AiError("provider_invalid", "Сервер AI прервал ответ. Попробуй ещё раз.");
    default: return new AiError("provider_unavailable", "Сервер AI временно недоступен. Попробуй позже.");
  }
}

function checkResponse(response: Response, selfHosted: boolean) {
  if ([401, 403].includes(response.status)) throw new AiError("provider_auth", "AI временно недоступен: требуется проверка настроек сервера.");
  if (response.status === 429 || response.status === 402)
    throw selfHosted ? providerError("busy") : new AiError("provider_limit", "Бесплатный лимит провайдера исчерпан. Попробуй позже.", 429, 60);
  if (response.status === 504) throw providerError("timeout");
  if (selfHosted && [400, 413, 415].includes(response.status)) throw providerError("invalid_context");
  if (selfHosted && response.status === 502) throw providerError("invalid_response");
  if (!response.ok) throw providerError("provider_unavailable");
}

/** A single local-weights gateway. No catalogue request or cloud fallback. */
export async function* streamReply(config: AiConfig, model: string, messages: AiMessage[], signal?: AbortSignal, fetcher: typeof fetch = fetch): AsyncGenerator<string> {
  if (config.provider !== "ollama" || !config.ready || !config.gatewayUrl)
    throw new AiError("not_configured", "Сервер модели пока не подключён.");
  const upstreamSignal = AbortSignal.any([AbortSignal.timeout(50000), ...(signal ? [signal] : [])]);
  const context = providerMessages(config, messages);
  let response: Response;
  try {
    response = await fetcher(`${config.gatewayUrl}/v1/chat`, {
      method: "POST", cache: "no-store", redirect: "manual", signal: upstreamSignal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.gatewayToken}` },
      body: JSON.stringify({ model, messages: context, maxOutputTokens: config.maxOutputTokens }),
    });
  } catch { throw providerError(upstreamSignal.aborted ? "timeout" : "provider_unavailable"); }
  checkResponse(response, true);
  if (!response.body || !response.headers.get("content-type")?.startsWith("application/x-ndjson"))
    throw new AiError("provider_invalid", "Сервер AI вернул некорректный ответ.");
  let hasText = false;
  try {
    for await (const event of readNdjson(response.body)) {
      if (event.type === "delta") { hasText ||= Boolean(event.text.trim()); yield event.text; }
      else if (event.type === "error") throw providerError(event.code);
      else if (event.type === "done") {
        if (!hasText) throw new AiError("provider_invalid", "Модель вернула пустой ответ. Попробуй позже.");
        return;
      } else throw new AiError("provider_invalid", "Сервер AI вернул некорректный ответ.");
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw upstreamSignal.aborted ? providerError("timeout") : new AiError("provider_invalid", "Соединение с AI прервано. Попробуй ещё раз.");
  }
}

export async function probeAi(config: AiConfig, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!config.enabled || !config.ready) return false;
  if (config.provider === "openrouter") return true;
  try {
    const response = await fetcher(`${config.gatewayUrl}/healthz`, {
      cache: "no-store", redirect: "manual",
      signal: AbortSignal.any([AbortSignal.timeout(3000), ...(signal ? [signal] : [])]),
      headers: { Authorization: `Bearer ${config.gatewayToken}` },
    });
    if (!response.ok) return false;
    const result = await boundedJson(response, 4096) as { ready?: unknown; model?: unknown };
    return result?.ready === true && result.model === config.model;
  } catch { return false; }
}

export async function generateReply(config: AiConfig, model: string, messages: AiMessage[], signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  if (config.provider === "ollama") {
    let reply = "";
    for await (const delta of streamReply(config, model, messages, signal, fetcher)) reply += delta;
    return { reply: reply.trim(), model };
  }
  if (!freeModelId(model)) throw new AiError("paid_model_blocked", "Платная модель заблокирована.");
  const context = providerMessages(config, messages);
  let response: Response;
  try {
    response = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", cache: "no-store", redirect: "manual",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}`, "X-OpenRouter-Title": "NEXUS" },
      signal: AbortSignal.any([AbortSignal.timeout(22000), ...(signal ? [signal] : [])]),
      body: JSON.stringify({
        model, messages: context, stream: false, max_tokens: config.maxOutputTokens,
        // Compatibility is explicit, zero-priced, and never an Ollama fallback.
        provider: { max_price: { prompt: 0, completion: 0, request: 0, image: 0 }, allow_fallbacks: false, data_collection: "deny" },
        reasoning: { effort: "none", exclude: true },
      }),
    });
  } catch { throw providerError("timeout"); }
  checkResponse(response, false);
  let result: Record<string, unknown>;
  try { result = await boundedJson(response, 131072) as Record<string, unknown>; }
  catch { throw new AiError("provider_invalid", "Не удалось получить ответ модели."); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new AiError("provider_invalid", "Модель вернула некорректный ответ.");
  const content = (result.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim() || content.length > 16000)
    throw new AiError("provider_invalid", "Модель вернула пустой ответ. Попробуй позже.");
  return { reply: content.trim(), model: typeof result.model === "string" ? result.model : model };
}
