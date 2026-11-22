"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, Check, Copy, LoaderCircle, Plus, RotateCcw, Send, Sparkles, Square } from "lucide-react";
import { AiAnswer } from "./answer";
import { regenerationContext, requestMessages, type ChatMessage as Message } from "./chat-history";
import { readNdjson } from "./stream";
import styles from "./ai.module.css";

type StopResult = "confirmed" | "requested" | "unverified";
type Generation = { controller: AbortController; requestId?: string; stopProof?: string; stop?: Promise<StopResult> };
type Preview = { content: string; status?: string };

async function requestStop(requestId: string, stopProof: string): Promise<StopResult> {
  try {
    const response = await fetch("/api/ai", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, stopProof }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return "unverified";
    const result: { stopped?: unknown } | null = await response.json().catch(() => null);
    return result?.stopped === true ? "confirmed" : "requested";
  } catch {
    return "unverified";
  }
}

const stopStatus: Record<StopResult, string> = {
  confirmed: "Генерация остановлена.",
  requested: "Запрос на остановку принят. Подтверждение от модели ещё не получено.",
  unverified: "Не удалось подтвердить остановку генерации.",
};

export function AiChat({ enabled, dailyLimit, zeroGpu = false }: { enabled: boolean; dailyLimit: number; zeroGpu?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [copyError, setCopyError] = useState<number | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const generation = useRef<Generation | null>(null);
  const nextId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => () => {
    const active = generation.current;
    generation.current = null;
    if (!active?.stop) active?.controller.abort();
  }, []);
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
      behavior: (zeroGpu && pending) || matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest",
    });
  }, [messages, pending, preview, zeroGpu]);
  useEffect(() => {
    if (copied === null) return;
    const timer = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await ask(draft.trim());
  }

  async function ask(content: string, replaceId?: number, history = messages) {
    if (!enabled || !consent || !content || content.length > 4_000 || generation.current) return;
    const active: Generation = {
      controller: new AbortController(),
      requestId: zeroGpu ? crypto.randomUUID() : undefined,
    };
    generation.current = active;
    const timeout = window.setTimeout(() => { if (!active.stop) active.controller.abort(); }, 65_000);
    setPending(true);
    setPendingQuestion(replaceId === undefined ? content : "");
    setPreview(null);
    setNotice("");
    setError("");
    let reply = "";
    let completed = false;
    let stopResult: StopResult | undefined;
    let description = "";
    const updateRemaining = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) setRemaining(Math.max(0, value));
    };
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages(history, content), consent: true, requestId: active.requestId }),
        signal: active.controller.signal,
      });
      if (zeroGpu && response.ok && response.body && response.headers.get("content-type")?.includes("application/x-ndjson")) {
        for await (const event of readNdjson(response.body)) {
          if (generation.current !== active) return;
          if (event.type === "meta") {
            active.stopProof = event.stopProof;
            updateRemaining(event.userRemaining);
          } else if (event.type === "delta") {
            reply += event.text;
            setPreview({ content: reply });
          } else if (event.type === "error") throw new Error(event.error);
          else if (event.type === "stopped") stopResult = "confirmed";
          else if (event.type === "done") completed = true;
        }
      } else {
        const result: { reply?: unknown; error?: unknown; retryAfter?: unknown; userRemaining?: unknown } = await response.json();
        if (generation.current !== active) return;
        updateRemaining(result.userRemaining);
        if (!response.ok || typeof result.reply !== "string" || !result.reply.trim()) {
          const error = typeof result.error === "string" ? result.error : "Не удалось получить ответ. Попробуй ещё раз.";
          const retry = typeof result.retryAfter === "number" && result.retryAfter > 0
            ? ` Повтори через ${Math.ceil(result.retryAfter)} сек.` : "";
          throw new Error(error + retry);
        }
        reply = result.reply;
        completed = true;
      }
      if (completed && !reply.trim()) {
        completed = false;
        throw new Error("Модель вернула пустой ответ. Попробуй ещё раз.");
      }
    } catch (failure) {
      description = active.controller.signal.aborted
        ? "Ответ занял слишком много времени. Текст сохранён — попробуй отправить ещё раз."
        : failure instanceof Error && !(failure instanceof TypeError)
          ? failure.message : "Нет связи с ассистентом. Проверь подключение и попробуй ещё раз.";
    } finally {
      window.clearTimeout(timeout);
      if (active.stop && !completed) {
        const result = await active.stop;
        stopResult ??= result;
      }
      if (generation.current === active) {
        const status = stopResult ? stopStatus[stopResult] : "Ответ прерван.";
        const hasReply = Boolean(reply.trim());
        const partialStatus = `${status} Сохранена полученная часть ответа.`;
        if (hasReply && replaceId === undefined) {
          const question: Message = { id: nextId.current++, role: "user", content };
          const answer: Message = { id: nextId.current++, role: "assistant", content: reply, status: completed ? undefined : partialStatus };
          setMessages((previous) => [...previous, question, answer]);
          setDraft("");
          setPreview(null);
        } else if (completed) {
          setMessages((previous) => previous.map((message) => message.id === replaceId
            ? { ...message, content: reply, status: undefined } : message));
          setPreview(null);
        } else if (hasReply) {
          setPreview({ content: reply, status: `${partialStatus} Предыдущий ответ сохранён.` });
        } else {
          setPreview(null);
          if (stopResult) setNotice(`${status} ${replaceId === undefined ? "Вопрос сохранён в поле ввода." : "Предыдущий ответ сохранён."}`);
        }
        if (!stopResult && description) setError(description);
        generation.current = null;
        setStopping(false);
        setPending(false);
        setPendingQuestion("");
        if (replaceId === undefined) input.current?.focus({ preventScroll: true });
      }
    }
  }

  function stop() {
    const active = generation.current;
    if (!active?.requestId || active.stop) return;
    setStopping(true);
    const cancellation = active.stopProof ? requestStop(active.requestId, active.stopProof) : Promise.resolve<StopResult>("unverified");
    active.stop = cancellation.then((result) => {
      active.controller.abort();
      return result;
    });
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
        onClick={() => { setMessages([]); setDraft(""); setError(""); setNotice(""); setPreview(null); setCopied(null); setCopyError(null); setConsent(false); stickToBottom.current = true; input.current?.focus({ preventScroll: true }); }}>
        <Plus size={16} aria-hidden="true" /> Новый диалог
      </button>}
    </header>

    {!enabled ? <div className={`card ${styles.empty}`}>
      <Sparkles size={32} aria-hidden="true" />
      <h2>Ассистент пока недоступен</h2>
      <p>Подключение AI настраивается. Когда настройка завершится, здесь можно будет задать вопрос.</p>
    </div> : <>
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
            {message.status && <p className={styles.streamStatus} role="status">{message.status}</p>}
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
        {preview && <article className={`${styles.message} ${styles.answer}`} aria-label={pending ? "Генерируемый ответ" : "Прерванный повторный ответ"}>
          <span className={styles.author}>NEXUS AI</span>
          <AiAnswer content={preview.content} />
          {preview.status && <p className={styles.streamStatus} role="status">{preview.status}</p>}
        </article>}
        {pending && <div className={styles.generating} role="status"><span className={styles.generatingDots} aria-hidden="true"><i /><i /><i /></span><span>{stopping ? "Запрашиваем остановку…" : preview ? "Генерация ответа…" : "Ассистент готовит ответ…"}</span></div>}
        <div ref={bottom} />
      </div>

      {showLatest && (messages.length > 0 || preview) && <button type="button" className={styles.latest} onClick={() => {
        stickToBottom.current = true;
        bottom.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "end" });
      }}><ArrowDown size={15} aria-hidden="true" /> К последнему ответу</button>}

      <form className={styles.composer} onSubmit={send}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.streamStatus} role="status">{notice}</p>}
        {!messages.length && <label className={styles.consent}>
          <input type="checkbox" checked={consent} disabled={pending} onChange={(event) => setConsent(event.target.checked)} />
          <span>{zeroGpu
            ? <>Я согласен передать текст вопроса и текущего диалога в Hugging Face для получения ответа. Ответы доступны только в бесплатном демо ZeroGPU с ограниченной доступностью. Другие данные NEXUS не отправляются. <a href="https://huggingface.co/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a></>
            : <>Я согласен передать текст вопроса и текущего диалога в OpenRouter и внешнюю AI-модель для получения ответа. Другие данные NEXUS не отправляются. <a href="https://openrouter.ai/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a></>}</span>
        </label>}
        <label className="sr-only" htmlFor="ai-question">Твой вопрос</label>
        <textarea id="ai-question" ref={input} value={draft} maxLength={4_000} rows={3} disabled={pending}
          placeholder="Задай вопрос…" aria-describedby="ai-input-help"
          onChange={(event) => setDraft(event.target.value)} />
        <div className={styles.composerFooter}>
          <span id="ai-input-help">{draft.length} / 4000</span>
          {zeroGpu && pending ? <button key="stop" className="button button-secondary" type="button" disabled={stopping} onClick={stop}>
            <Square size={15} aria-hidden="true" /> {stopping ? "Останавливаем…" : "Остановить"}
          </button> : <button key="send" className="button button-primary" type="submit" disabled={pending || !consent || !draft.trim() || remaining === 0}>
            {pending ? <LoaderCircle className={styles.spinner} size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
            {pending ? "Отправка…" : error ? "Повторить отправку" : "Отправить"}
          </button>}
        </div>
        <p className={styles.footnote}>AI может ошибаться — проверяй важные факты. Не отправляй пароли и личные сведения. Диалог исчезнет после обновления страницы.</p>
      </form>
    </>}
  </section>;
}
