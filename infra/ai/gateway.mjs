import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const BODY_LIMIT = 64 * 1024;
const RESPONSE_LIMIT = 2 * 1024 * 1024;
const LINE_LIMIT = 128 * 1024;
const OUTPUT_LIMIT = 16000;
const messagesByCode = {
  unauthorized: "Доступ запрещён.", invalid_request: "Некорректный запрос.",
  too_large: "Слишком большой запрос.", busy: "AI занят. Попробуй чуть позже.",
  timeout: "AI не успел ответить. Попробуй ещё раз.",
  unavailable: "AI временно недоступен.", invalid_response: "AI вернул неполный ответ.",
};
class GatewayError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}
const validModel = (value) => typeof value === "string" &&
  /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)?$/.test(value) && !/cloud/i.test(value);
const hash = (value) => createHash("sha256").update(value).digest();

function validateInput(input, model) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.model !== model ||
      !Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 1200 ||
      !Array.isArray(input.messages)) throw new GatewayError("invalid_request", 400);
  const messages = input.messages;
  const system = messages[0]?.role === "system" ? 1 : 0;
  const history = messages.slice(system);
  if (history.length < 1 || history.length > 7 || history.length % 2 !== 1 || messages.length > 8)
    throw new GatewayError("invalid_request", 400);
  let total = 0;
  const clean = messages.map((message, index) => {
    const role = index < system ? "system" : (index - system) % 2 ? "assistant" : "user";
    if (!message || message.role !== role || typeof message.content !== "string" ||
        !message.content.trim() || message.content.length > 4000)
      throw new GatewayError("invalid_request", 400);
    if (index >= system) total += message.content.length;
    return { role, content: message.content };
  });
  if (total > 12000 || clean.reduce((bytes, message) => bytes + Buffer.byteLength(message.content), 0) + input.maxOutputTokens + 512 > 16384)
    throw new GatewayError("invalid_request", 400);
  return { messages: clean, maxOutputTokens: input.maxOutputTokens };
}

async function readJson(request) {
  const length = request.headers["content-length"];
  if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT))
    throw new GatewayError("too_large", 413);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > BODY_LIMIT) throw new GatewayError("too_large", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new GatewayError("invalid_request", 400); }
}

function json(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
function errorBody(code) { return { type: "error", code, error: messagesByCode[code] ?? messagesByCode.unavailable }; }

async function writeEvent(response, value, signal) {
  if (response.destroyed || response.writableEnded || signal.aborted) throw signal.reason ?? new Error("closed");
  if (response.write(`${JSON.stringify(value)}\n`)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      response.off("drain", drain); response.off("close", closed); signal.removeEventListener("abort", aborted);
    };
    const drain = () => { cleanup(); resolve(); };
    const closed = () => { cleanup(); reject(new Error("closed")); };
    const aborted = () => { cleanup(); reject(signal.reason); };
    response.once("drain", drain); response.once("close", closed); signal.addEventListener("abort", aborted, { once: true });
  });
}

/** HTTP boundary only; no request history, prompts or bearer values are persisted. */
export function createGateway({ token, model = "gpt-oss:20b", ollamaUrl = "http://ollama:11434", deadlineMs = 50000, fetchImpl = fetch, log = (code) => console.error(code) }) {
  if (typeof token !== "string" || token.length < 32 || token.length > 512 || /\s/.test(token))
    throw new Error("invalid_gateway_token");
  if (!validModel(model)) throw new Error("invalid_local_model");
  const base = new URL(ollamaUrl);
  if (base.protocol !== "http:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    throw new Error("invalid_ollama_url");
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 50000) throw new Error("invalid_deadline");
  const expectedToken = hash(`Bearer ${token}`);
  let busy = false;
  const active = new Set();
  const server = createServer(async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff");
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || authorization.length > 520 || !timingSafeEqual(hash(authorization), expectedToken)) {
      response.setHeader("connection", "close");
      json(response, 401, errorBody("unauthorized")); return;
    }
    if (request.url !== "/healthz" && request.url !== "/v1/chat") { json(response, 404, errorBody("invalid_request")); return; }
    if ((request.url === "/healthz" && request.method !== "GET") || (request.url === "/v1/chat" && request.method !== "POST")) {
      json(response, 405, errorBody("invalid_request")); return;
    }
    const controller = new AbortController();
    active.add(controller);
    const timer = setTimeout(() => controller.abort(new GatewayError("timeout", 504)), request.url === "/healthz" ? Math.min(5000, deadlineMs) : deadlineMs);
    timer.unref();
    const disconnect = () => { if (!response.writableEnded) controller.abort(new Error("client_closed")); };
    response.once("close", disconnect);
    request.once("aborted", disconnect);
    let ownsSlot = false;
    let reader;
    try {
      if (request.url === "/healthz") {
        const result = await fetchImpl(new URL("/api/tags", base), { signal: controller.signal });
        if (!result.ok || !result.body) throw new GatewayError("unavailable", 503);
        reader = result.body.getReader();
        const chunks = []; let bytes = 0;
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          bytes += value.byteLength; if (bytes > BODY_LIMIT) throw new GatewayError("unavailable", 503);
          chunks.push(value);
        }
        const tags = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
        const ready = Array.isArray(tags.models) && tags.models.some((item) => item?.name === model || item?.model === model);
        json(response, ready ? 200 : 503, { ready, model });
        return;
      }
      if (busy) {
        response.setHeader("retry-after", "5"); response.setHeader("connection", "close");
        json(response, 429, errorBody("busy")); return;
      }
      busy = true; ownsSlot = true;
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) throw new GatewayError("invalid_request", 415);
      const input = validateInput(await readJson(request), model);
      if (controller.signal.aborted) throw controller.signal.reason;
      const upstream = await fetchImpl(new URL("/api/chat", base), {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ model, messages: input.messages, stream: true,
          ...(model.startsWith("gpt-oss:") ? { think: "low" } : { think: false }),
          keep_alive: "10m", options: { num_ctx: 16384, num_predict: input.maxOutputTokens } }),
      });
      if (!upstream.ok || !upstream.body) throw new GatewayError("unavailable", 503);
      reader = upstream.body.getReader();
      response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" });
      response.flushHeaders();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "", bytes = 0, outputLength = 0, finished = false;
      const consume = async (line) => {
        if (!line.trim()) return;
        if (line.length > LINE_LIMIT) throw new GatewayError("invalid_response");
        let item; try { item = JSON.parse(line); } catch { throw new GatewayError("invalid_response"); }
        if (!item || typeof item !== "object" || item.error || (item.model && item.model !== model) ||
            (item.message?.role && item.message.role !== "assistant")) throw new GatewayError("invalid_response");
        const content = item.message?.content;
        if (content !== undefined && typeof content !== "string") throw new GatewayError("invalid_response");
        // Deliberately never relay thinking, tools, raw errors, timings or provider metadata.
        if (content) {
          outputLength += content.length;
          if (outputLength > OUTPUT_LIMIT) throw new GatewayError("invalid_response");
          await writeEvent(response, { type: "delta", text: content }, controller.signal);
        }
        if (item.done === true) {
          if (!outputLength) throw new GatewayError("invalid_response");
          await writeEvent(response, { type: "done" }, controller.signal); finished = true;
        }
      };
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) { buffer += decoder.decode(); if (buffer) await consume(buffer); break; }
        bytes += value.byteLength; if (bytes > RESPONSE_LIMIT) throw new GatewayError("invalid_response");
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while (!finished && (newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); await consume(line);
        }
        if (buffer.length > LINE_LIMIT) throw new GatewayError("invalid_response");
      }
      if (!finished) throw new GatewayError("invalid_response");
      response.end();
    } catch (error) {
      const timedOut = controller.signal.reason instanceof GatewayError && controller.signal.reason.code === "timeout";
      const failure = timedOut ? controller.signal.reason : error instanceof GatewayError ? error : new GatewayError("unavailable", 503);
      if (!response.destroyed && !response.writableEnded) {
        if (request.url === "/healthz") json(response, 503, { ready: false, model });
        else if (response.headersSent) response.end(`${JSON.stringify(errorBody(failure.code))}\n`);
        else json(response, failure.status, errorBody(failure.code));
      }
      if (!controller.signal.aborted || timedOut) log(failure.code);
    } finally {
      // Do not release the only generation slot while an upstream fetch/read is still active.
      controller.abort();
      if (reader) { try { await reader.cancel(); } catch { /* already aborted */ } }
      clearTimeout(timer); active.delete(controller);
      request.off("aborted", disconnect); response.off("close", disconnect);
      if (ownsSlot) busy = false;
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 30;
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
  server.on("close", () => { for (const controller of active) controller.abort(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGateway({ token: process.env.AI_GATEWAY_TOKEN, model: process.env.AI_MODEL || "gpt-oss:20b", ollamaUrl: process.env.OLLAMA_BASE_URL || "http://ollama:11434" });
  server.listen(8080, "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
    server.close(); server.closeAllConnections();
  });
}
