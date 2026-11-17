import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import { AiError, boundedJson } from "../validation.ts";
import type { AgentConfig } from "./config.ts";
import type { Source } from "./contracts.ts";

export function publicUrl(value: string): URL {
  if (value.length > 2048) throw new AiError("unsafe_url", "Адрес слишком длинный.", 400);
  let url: URL;
  try { url = new URL(value); } catch { throw new AiError("unsafe_url", "Некорректный адрес.", 400); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
    !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion|home|lan)$/.test(host) ||
    ipaddr.isValid(host.replace(/^\[|\]$/g, "")))
    throw new AiError("unsafe_url", "Разрешены только публичные сайты на стандартных HTTP(S)-портах.", 400);
  url.hash = "";
  url.hostname = host;
  return url;
}
export function isPublicAddress(address: string) {
  try { const ip = ipaddr.process(address); return ip.range() === "unicast"; } catch { return false; }
}
export async function publicAddresses(host: string, resolver: (host: string, options: LookupAllOptions) => Promise<LookupAddress[]> = lookup) {
  const addresses = await resolver(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address)))
    throw new AiError("unsafe_url", "Внутренние и служебные адреса запрещены.", 400);
  return addresses;
}

const PAGE_LIMIT = 512 * 1024;
// Validate every DNS answer, then pin the connection to one checked address. A second DNS lookup
// cannot turn a public host into a loopback/private connection. SNI and Host remain the URL hostname.
async function fetchPinned(url: URL, signal: AbortSignal): Promise<{ status: number; location?: string; html: string }> {
  const addresses = await publicAddresses(url.hostname);
  signal.throwIfAborted();
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = transport(url, {
      method: "GET", signal, agent: false,
      headers: { "User-Agent": "NEXUS-Research/1.0", Accept: "text/html,text/plain", "Accept-Encoding": "identity" },
      lookup: (_host, options, callback) => options.all
        ? callback(null, [selected]) : callback(null, selected.address, selected.family),
    }, (response) => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy(); resolve({ status, location: response.headers.location, html: "" }); return;
      }
      if (status !== 200 || !/^(?:text\/html|text\/plain)(?:;|$)/i.test(response.headers["content-type"] || "") ||
        Number(response.headers["content-length"] || 0) > PAGE_LIMIT ||
        (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
        response.destroy(); reject(new AiError("page_unavailable", "Страница недоступна, слишком велика или имеет неподдерживаемый формат.")); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > PAGE_LIMIT) { response.destroy(); reject(new AiError("page_too_large", "Страница слишком велика.")); }
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, html: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
      response.on("aborted", () => reject(new AiError("page_unavailable", "Загрузка страницы прервалась.")));
    });
    req.on("error", reject); req.end();
  });
}

export function extractPage(html: string) {
  const $ = load(html);
  const title = $("title").first().text().trim().slice(0, 240);
  const published = $('meta[property="article:published_time"]').attr("content")?.slice(0, 50);
  $("script,style,noscript,nav,header,footer,aside,form,iframe,svg,template,[hidden],[aria-hidden=true]").remove();
  const main = $("main,article,[role=main]").first();
  const text = (main.length ? main : $("body")).text().replace(/\s+/g, " ").trim();
  return { title, published, text: text.slice(0, 10000), truncated: text.length > 10000 };
}

export async function readWebPage(value: string, signal: AbortSignal, fetchPage = fetchPinned) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  let url = publicUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    // Includes DNS resolution in the deadline, even when the resolver itself stalls.
    const response = await Promise.race([
      fetchPage(url, deadline),
      new Promise<never>((_, reject) => {
        if (deadline.aborted) reject(deadline.reason);
        else deadline.addEventListener("abort", () => reject(deadline.reason), { once: true });
      }),
    ]);
    if (response.status === 200) return { ...extractPage(response.html), url: url.href, retrievedAt: new Date().toISOString(), trust: "untrusted_source_data" };
    if (!response.location || redirects === 3) break;
    const next = publicUrl(new URL(response.location, url).href);
    if (url.protocol === "https:" && next.protocol !== "https:") throw new AiError("unsafe_url", "Небезопасный переход страницы.");
    url = next;
  }
  throw new AiError("redirect_limit", "Слишком много переходов или некорректный ответ страницы.");
}

export async function searchWeb(config: AgentConfig, query: string, freshness: "pw" | "pm" | "py" | undefined, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Omit<Source, "id">[]> {
  if (!config.searchEnabled) throw new AiError("search_unavailable", "Веб-поиск не подключён. Актуальные сведения не проверены.");
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  const options = { cache: "no-store", redirect: "error", signal: deadline } as const;
  let response: Response;
  if (config.searchProvider === "firecrawl") {
    const periods = { pw: "qdr:w", pm: "qdr:m", py: "qdr:y" };
    response = await fetcher("https://api.firecrawl.dev/v2/search", {
      ...options, method: "POST",
      headers: { Authorization: `Bearer ${config.searchKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, limit: 5, sources: [{ type: "web" }], safe: true, timeout: 8500,
        ...(freshness ? { tbs: periods[freshness] } : {}) }),
    });
  } else {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query); url.searchParams.set("count", "5"); url.searchParams.set("safesearch", "moderate");
    if (freshness) url.searchParams.set("freshness", freshness);
    response = await fetcher(url, { ...options, headers: { "X-Subscription-Token": config.searchKey, Accept: "application/json" } });
  }
  if (!response.ok) throw new AiError("search_unavailable", "Поисковый сервис сейчас недоступен. Свежие данные не получены.");
  const data = await boundedJson(response, 512000) as { success?: boolean; data?: { web?: unknown[] }; web?: { results?: unknown[] } };
  if (config.searchProvider === "firecrawl" && data?.success !== true)
    throw new AiError("search_unavailable", "Firecrawl не вернул результаты поиска.");
  const results = config.searchProvider === "firecrawl" ? data?.data?.web : data?.web?.results;
  return (Array.isArray(results) ? results : []).slice(0, 5).flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    if (!item || typeof item.url !== "string" || typeof item.title !== "string") return [];
    try { return [{ url: publicUrl(item.url).href, title: item.title.slice(0, 240),
      snippet: typeof item.description === "string" ? load(item.description).text().slice(0, 900) : "",
      published: typeof item.page_age === "string" ? item.page_age.slice(0, 80) : undefined,
      retrievedAt: new Date().toISOString(), kind: "web" as const }]; } catch { return []; }
  });
}
