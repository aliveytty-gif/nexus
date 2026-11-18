import { z } from "zod";

export const modeSchema = z.enum(["auto", "quick", "research", "solve"]);
export type AgentMode = z.infer<typeof modeSchema>;
export const requestSchema = z.object({
  threadId: z.uuid(), turnId: z.uuid(), runId: z.uuid(),
  question: z.string().trim().min(1).max(4000), mode: modeSchema,
  consent: z.literal(true), nexusContext: z.boolean().default(false),
}).strict();
export type AgentRequest = z.infer<typeof requestSchema>;
export const preferencesSchema = z.object({ enabled: z.boolean(), content: z.string().trim().max(2000), consent: z.boolean() }).strict()
  .refine((v) => !v.enabled || v.consent, "Нужно отдельное согласие на память.");
export type Source = { id: string; title: string; url: string; snippet?: string; published?: string; retrievedAt: string; kind: "web" | "nexus" };
export function safeSourceUrl(value: string) {
  if (/^\/posts\/[0-9a-f-]{36}$/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Relative or malformed URL. */ }
  return "";
}
const sourceSchema = z.object({ id: z.string().regex(/^S\d{1,2}$/), title: z.string().min(1).max(240), url: z.string().max(2048),
  published: z.string().max(80).optional(), retrievedAt: z.iso.datetime(), kind: z.enum(["web", "nexus"]) });
export function validSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap((item) => {
    const source = sourceSchema.safeParse(item);
    if (!source.success) return [];
    const url = safeSourceUrl(source.data.url);
    if (!url || url.startsWith("/") !== (source.data.kind === "nexus")) return [];
    return [{ ...source.data, url }];
  });
}
export type Action = { id: string; tool: string; label: string; status: "running" | "complete" | "error" };
export type Usage = { calls: number; toolCalls: number; searchCalls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; reservedCostUsd: number; model: string; promptVersion: string };
export type AgentEvent =
  | { type: "start"; threadId: string; turnId: string; runId: string }
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "action"; action: Action }
  | { type: "source"; source: Source }
  | { type: "quota"; remaining: number }
  | { type: "done"; answer: string; sources: Source[]; usage: Usage }
  | { type: "error"; code: string; message: string };

export const modeSettings: Record<AgentMode, { steps: number; tools: number; output: number; instruction: string }> = {
  quick: { steps: 1, tools: 0, output: 600, instruction: "Дай короткий прямой ответ. Инструменты в этом режиме отключены. Не заявляй об актуальной проверке." },
  auto: { steps: 4, tools: 5, output: 1400, instruction: "Для простого вопроса ответь сразу. Для сложного дай краткий план действий и выбери нужные инструменты." },
  research: { steps: 3, tools: 3, output: 2200, instruction: "Исследуй вопрос: сначала несколько независимых поисковых запросов, затем при необходимости прочитай до двух ключевых страниц и подготовь итоговое сравнение. Укажи даты, спорные утверждения и неопределённость. Если поиск отключён, прямо сообщи об этом." },
  solve: { steps: 4, tools: 5, output: 1800, instruction: "Объясни решение понятными проверяемыми шагами. Для точной арифметики используй calculate. Проверь единицы и результат." },
};
