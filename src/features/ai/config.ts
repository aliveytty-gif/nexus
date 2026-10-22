import "server-only";
import { isIP } from "node:net";

export type AiConfig = {
  enabled: boolean; ready: boolean; provider: "openrouter" | "ollama";
  apiKey: string; model: string; fallbackModel: string;
  userLimit: number; globalLimit: number; maxOutputTokens: number;
  gatewayUrl: string; gatewayToken: string; streaming: boolean; systemInstructions: string;
};
const integer = (value: string | undefined, fallback: number, max: number) =>
  value && /^\d+$/.test(value) ? Math.min(max, Math.max(1, Number(value))) : fallback;

function gatewayOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || value.includes("?") || value.includes("#")) return "";
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
    if (local) return !process.env.VERCEL && process.env.NODE_ENV === "development" &&
      ["http:", "https:"].includes(url.protocol) ? url.origin : "";
    // Only a public HTTPS origin receives the secret. Direct IP hosts are not
    // supported; a named TLS endpoint keeps deployment portable and explicit.
    if (url.protocol !== "https:" || isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return "";
    return url.origin;
  } catch { return ""; }
}

export function getAiConfig(): AiConfig {
  const provider = process.env.AI_PROVIDER === "openrouter" ? "openrouter" : "ollama";
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  const gatewayUrl = gatewayOrigin(process.env.AI_GATEWAY_URL?.trim() ?? "");
  const gatewayToken = process.env.AI_GATEWAY_TOKEN?.trim() ?? "";
  const model = process.env.AI_MODEL?.trim() || (provider === "ollama" ? "gpt-oss:20b" : "deepseek/deepseek-v4-flash-0731:free");
  const systemInstructions = process.env.AI_SYSTEM_INSTRUCTIONS?.trim() ?? "";
  const localModel = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model) && !/(?:[:/-])cloud(?:[:/-]|$)/i.test(model);
  return {
    enabled: process.env.AI_ENABLED === "true",
    ready: provider === "ollama" ? Boolean(gatewayUrl && /^[\x21-\x7e]{32,512}$/.test(gatewayToken) && localModel && systemInstructions.length <= 2000) : Boolean(apiKey && systemInstructions.length <= 2000),
    provider, apiKey, model,
    fallbackModel: process.env.AI_FALLBACK_MODEL?.trim() || "openrouter/free",
    userLimit: integer(process.env.AI_DAILY_USER_LIMIT, 5, 50),
    globalLimit: integer(process.env.AI_DAILY_GLOBAL_LIMIT, 40, 50),
    maxOutputTokens: integer(process.env.AI_MAX_OUTPUT_TOKENS, 400, 1200),
    gatewayUrl, gatewayToken, streaming: process.env.AI_STREAMING !== "false",
    systemInstructions,
  };
}
