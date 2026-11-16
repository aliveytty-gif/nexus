"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, Check, Copy, Plus, RotateCcw, Send, Sparkles, Square } from "lucide-react";
import { AiAnswer } from "./answer";
import { regenerationContext, requestMessages, type ChatMessage as Message } from "./chat-history";
import { readNdjson } from "./stream";
import styles from "./ai.module.css";

type Connection = "checking" | "ready" | "unavailable" | "not_configured";
type Generation = { controller: AbortController; content: string; replaceId?: number; reply: string; timer?: number; timedOut: boolean };
const unavailableCodes = ["provider_timeout", "provider_unavailable", "provider_invalid", "provider_auth", "model_unavailable"];

export function AiChat({ enabled, dailyLimit, provider = "ollama" }: { enabled: boolean; dailyLimit: number; provider?: "ollama" | "openrouter" }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const [streamLabel, setStreamLabel] = useState("");
  const [answerStatus, setAnswerStatus] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState("");
  const [connection, setConnection] = useState<Connection>("checking");
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [copyError, setCopyError] = useState<number | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const generation = useRef<Generation | null>(null);
  const statusController = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => () => {
    const active = generation.current;
    generation.current = null;
    if (active?.timer) window.clearTimeout(active.timer);
    active?.controller.abort();
    statusController.current?.abort();
    statusController.current = null;
  }, []);
  const checkConnection = useCallback(() => {
    statusController.current?.abort();
    const active = new AbortController();
    statusController.current = active;
    const timeout = window.setTimeout(() => active.abort(), 10_000);
    void fetch("/api/ai", { signal: active.signal, cache: "no-store" }).then(async (response) => {
      const result: { status?: unknown } = await response.json();
      if (statusController.current !== active) return;
      setConnection(response.ok && (result.status === "ready" || result.status === "not_configured") ? result.status : "unavailable");
    }).catch(() => {
      if (statusController.current === active) setConnection("unavailable");
    }).finally(() => {
      window.clearTimeout(timeout);
      if (statusController.current === active) statusController.current = null;
    });
  }, []);
  useEffect(() => { if (enabled) void checkConnection(); }, [enabled, checkConnection]);
  useEffect(() => {
    const update = () => {
      stickToBottom.current = !bottom.current || bottom.current.getBoundingClientRect().top <= window.innerHeight + 140;
      setShowLatest(!stickToBottom.current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);
  useEffect(() => {
    if (stickToBottom.current) bottom.current?.scrollIntoView({
      behavior: pending || matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest",
    });
  }, [messages, pending, streamedAnswer]);
  useEffect(() => {
    if (copied === null) return;
    const timer = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await ask(draft.trim());
  }

  function finish(active: Generation, outcome: "done" | "stopped" | "error", description = "") {
    if (generation.current !== active) return;
    generation.current = null;
    window.clearTimeout(active.timer);
    if (outcome !== "done") active.controller.abort();
    setConnection((previous) => previous === "checking" ? "unavailable" : previous);
    const hasReply = Boolean(active.reply.trim());
    if (hasReply && (active.replaceId === undefined || outcome === "done")) {
      if (active.replaceId === undefined) {
        const question: Message = { id: nextId.current++, role: "user", content: active.content };
        const answer: Message = { id: nextId.current++, role: "assistant", content: active.reply };
        setMessages((previous) => [...previous, question, answer]);
        if (outcome !== "done") setAnswerStatus((previous) => ({ ...previous, [answer.id]: outcome === "stopped" ? "Генерация остановлена" : "Ответ прерван" }));
        setDraft("");
      } else {
        setMessages((previous) => previous.map((message) => message.id === active.replaceId ? { ...message, content: active.reply } : message));
        setAnswerStatus((previous) => { const next = { ...previous }; delete next[active.replaceId!]; return next; });
      }
      setStreamedAnswer("");
      setStreamLabel("");
    } else if (hasReply) {
      setStreamLabel(outcome === "stopped" ? "Повторная генерация остановлена · предыдущий ответ сохранён" : "Повторный ответ прерван · предыдущий ответ сохранён");
    } else {
      setStreamedAnswer("");
      setStreamLabel("");
    }
    if (description) setError(description);
    if (outcome === "stopped" && !hasReply) setNotice(active.replaceId === undefined
      ? "Генерация остановлена. Вопрос сохранён — его можно отправить снова."
      : "Повторная генерация остановлена. Предыдущий ответ сохранён.");
    setPending(false);
    setPendingQuestion("");
    if (active.replaceId === undefined) input.current?.focus({ preventScroll: true });
  }

  async function ask(content: string, replaceId?: number, history = messages) {
    if (!enabled || !consent || !content || content.length > 4_000 || generation.current) return;
    const active: Generation = { controller: new AbortController(), content, replaceId, reply: "", timedOut: false };
    generation.current = active;
    statusController.current?.abort();
    statusController.current = null;
    active.timer = window.setTimeout(() => { active.timedOut = true; active.controller.abort(); }, 65_000);
    setPending(true);
    setPendingQuestion(replaceId === undefined ? content : "");
    setStreamedAnswer("");
    setStreamLabel(replaceId === undefined ? "" : "Новый вариант ответа");
    setError("");
    setNotice("");
    const updateRemaining = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) setRemaining(Math.max(0, value));
    };
    let reportedError = false;
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages(history, content), consent: true }),
        signal: active.controller.signal,
      });
      if (response.ok && response.headers.get("content-type")?.includes("application/x-ndjson") && response.body) {
        for await (const event of readNdjson(response.body)) {
          if (generation.current !== active) return;
          if (event.type === "meta") { updateRemaining(event.userRemaining); setConnection("ready"); }
          else if (event.type === "delta") {
            active.reply += event.text;
            setStreamedAnswer(active.reply);
            setConnection("ready");
          } else if (event.type === "error") {
            reportedError = true;
            if (unavailableCodes.includes(event.code)) setConnection("unavailable");
            else if (event.code === "not_configured") setConnection("not_configured");
            throw new Error(event.error);
          }
        }
      } else {
        const result: { reply?: unknown; error?: unknown; code?: unknown; retryAfter?: unknown; userRemaining?: unknown } = await response.json();
        if (generation.current !== active) return;
        updateRemaining(result.userRemaining);
        if (!response.ok || typeof result.reply !== "string" || !result.reply.trim()) {
          reportedError = !response.ok;
          if (unavailableCodes.includes(String(result.code))) setConnection("unavailable");
          else if (result.code === "not_configured") setConnection("not_configured");
          const description = typeof result.error === "string" ? result.error : "Не удалось получить ответ. Попробуй ещё раз.";
          const retry = typeof result.retryAfter === "number" && result.retryAfter > 0 ? ` Повтори через ${Math.ceil(result.retryAfter)} сек.` : "";
          throw new Error(description + retry);
        }
        active.reply = result.reply;
        setConnection("ready");
      }
      if (!active.reply.trim()) throw new Error("Модель вернула пустой ответ. Попробуй ещё раз.");
      finish(active, "done");
    } catch (failure) {
      if (generation.current !== active) return;
      if (!reportedError || active.timedOut || failure instanceof TypeError) setConnection("unavailable");
      finish(active, "error", active.timedOut
        ? "Время ожидания истекло. Полученный текст сохранён; можно повторить запрос."
        : failure instanceof SyntaxError ? "Сервер вернул некорректный ответ. Попробуй ещё раз."
        : failure instanceof Error && !(failure instanceof TypeError)
          ? failure.message : "Нет связи с ассистентом. Проверь подключение и попробуй ещё раз.");
    }
  }

  async function copy(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(message.id);
      setCopyError(null);
    } catch {
      setCopyError(message.id);
      setCopied(null);
    }
  }

  return <section className={styles.chat}>
    <header className={styles.heading}>
      <div><h1><Sparkles size={25} aria-hidden="true" /> NEXUS AI</h1><p>Помощник для учёбы, идей и повседневных вопросов.</p></div>
      {enabled && <button className="button button-secondary" type="button" disabled={pending || (!messages.length && !draft)}
        onClick={() => { setMessages([]); setDraft(""); setError(""); setNotice(""); setStreamedAnswer(""); setStreamLabel(""); setAnswerStatus({}); setCopied(null); setCopyError(null); setConsent(false); stickToBottom.current = true; input.current?.focus({ preventScroll: true }); }}>
        <Plus size={16} aria-hidden="true" /> Новый диалог
      </button>}
    </header>

    {!enabled ? <div className={`card ${styles.empty}`}>
      <Sparkles size={32} aria-hidden="true" />
      <h2>Ассистент пока недоступен</h2>
      <p>Подключение AI настраивается. Когда настройка завершится, здесь можно будет задать вопрос.</p>
    </div> : <>
      <div className={styles.connection}>
        <span className={connection === "ready" ? styles.connected : undefined} role="status">
          {connection === "checking" ? "Проверяем соединение…" : connection === "ready" ? "Модель на связи" : connection === "not_configured" ? "Сервер модели ещё не настроен" : "Нет связи с сервером модели"}
        </span>
        <button type="button" className={styles.copy} disabled={pending || connection === "checking"} onClick={() => { setConnection("checking"); void checkConnection(); }}>
          <RotateCcw size={13} aria-hidden="true" /> Проверить соединение
        </button>
      </div>
      <p className={styles.limit} aria-live="polite">{remaining === null ? `До ${dailyLimit} обращений к модели в сутки` : `Осталось обращений сегодня: ${remaining} из ${dailyLimit}`}<span>Попытки получить ответ тоже учитываются.</span></p>

      <div className={styles.conversation} aria-label="Диалог с NEXUS AI" aria-busy={pending}>
        {!messages.length && !pending && <div className={styles.welcome}>
          <span className={styles.sparkle}><Sparkles size={28} aria-hidden="true" /></span>
          <h2>Что разберём сегодня?</h2>
          <p>Попроси объяснить тему, помочь с текстом или придумать идею.</p>
          <div className={styles.suggestions}>
            {["Объясни сложную тему простыми словами", "Помоги составить план подготовки к экзамену", "Предложи идеи для студенческого проекта"].map((suggestion) => <button key={suggestion} type="button"
              onClick={() => { setDraft(suggestion); input.current?.focus(); }}>{suggestion}</button>)}
          </div>
        </div>}
        {messages.map((message) => <article key={message.id} className={`${styles.message} ${message.role === "user" ? styles.mine : styles.answer}`}>
          <span className={styles.author}>{message.role === "user" ? "Ты" : "NEXUS AI"}</span>
          {message.role === "user" ? <p className={styles.question}>{message.content}</p> : <>
            <AiAnswer content={message.content} />
            {answerStatus[message.id] && <p className={styles.streamStatus} role="status">{answerStatus[message.id]}</p>}
            <div className={styles.answerActions}>
            <button type="button" className={styles.copy} onClick={() => void copy(message)} aria-label="Скопировать ответ">
              {copied === message.id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copied === message.id ? "Скопировано" : "Копировать"}
            </button>
            {message.id === messages.at(-1)?.id && <button type="button" className={styles.copy} disabled={pending || remaining === 0}
              title="Новая генерация расходует ещё одно обращение к AI" onClick={() => {
                const context = regenerationContext(messages);
                if (context) void ask(context.question.content, context.answer.id, context.history);
              }}><RotateCcw size={14} aria-hidden="true" /> Повторить ответ</button>}
            </div>
            {copyError === message.id && <p className={styles.copyError} role="status">Не удалось скопировать. Выдели текст ответа вручную.</p>}
          </>}
        </article>)}
        {pendingQuestion && <article className={`${styles.message} ${styles.mine}`}><span className={styles.author}>Ты</span><p className={styles.question}>{pendingQuestion}</p></article>}
        {streamedAnswer && <article className={`${styles.message} ${styles.answer}`} aria-label={pending ? "Генерируемый ответ" : "Прерванный повторный ответ"}>
          <span className={styles.author}>NEXUS AI</span><AiAnswer content={streamedAnswer} />
          {streamLabel && <p className={styles.streamStatus} role="status">{streamLabel}</p>}
        </article>}
        {pending && <div className={styles.generating} role="status"><span className={styles.generatingDots} aria-hidden="true"><i /><i /><i /></span><span>{streamedAnswer ? "Генерация ответа…" : "Ассистент готовит ответ…"}</span></div>}
        <div ref={bottom} />
      </div>

      {showLatest && (messages.length > 0 || streamedAnswer) && <button type="button" className={styles.latest} onClick={() => {
        stickToBottom.current = true;
        bottom.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "end" });
      }}><ArrowDown size={15} aria-hidden="true" /> К последнему ответу</button>}

      <form className={styles.composer} onSubmit={send}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.streamStatus} role="status">{notice}</p>}
        {!messages.length && <label className={styles.consent}>
          <input type="checkbox" checked={consent} disabled={pending} onChange={(event) => setConsent(event.target.checked)} />
          <span>{provider === "ollama"
            ? "Я согласен передать текст вопроса и текущего диалога на сервер модели NEXUS для получения ответа. Другие данные NEXUS не отправляются."
            : <>Я согласен передать текст вопроса и текущего диалога в OpenRouter и внешнюю AI-модель для получения ответа. Другие данные NEXUS не отправляются. <a href="https://openrouter.ai/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a></>}</span>
        </label>}
        <label className="sr-only" htmlFor="ai-question">Твой вопрос</label>
        <textarea id="ai-question" ref={input} value={draft} maxLength={4_000} rows={3} disabled={pending}
          placeholder="Задай вопрос…" aria-describedby="ai-input-help"
          onChange={(event) => setDraft(event.target.value)} />
        <div className={styles.composerFooter}>
          <span id="ai-input-help">{draft.length} / 4000</span>
          {pending ? <button key="stop" className="button button-secondary" type="button" onClick={(event) => { event.preventDefault(); const active = generation.current; if (active) finish(active, "stopped"); }}>
            <Square size={15} aria-hidden="true" /> Остановить
          </button> : <button key="send" className="button button-primary" type="submit" disabled={!consent || !draft.trim() || remaining === 0}>
            <Send size={17} aria-hidden="true" />{error ? "Повторить отправку" : "Отправить"}
          </button>}
        </div>
        <p className={styles.footnote}>AI может ошибаться — проверяй важные факты. Не отправляй пароли и личные сведения. Диалог исчезнет после обновления страницы.</p>
      </form>
    </>}
  </section>;
}
