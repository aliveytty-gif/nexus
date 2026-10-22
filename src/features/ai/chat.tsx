"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, Check, Copy, LoaderCircle, Plus, RotateCcw, Send, Sparkles } from "lucide-react";
import { AiAnswer } from "./answer";
import { regenerationContext, requestMessages, type ChatMessage as Message } from "./chat-history";
import styles from "./ai.module.css";

export function AiChat({ enabled, dailyLimit }: { enabled: boolean; dailyLimit: number }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [copyError, setCopyError] = useState<number | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => () => {
    const active = controller.current;
    controller.current = null;
    active?.abort();
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
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest",
    });
  }, [messages, pending]);
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
    if (!enabled || !consent || !content || content.length > 4_000 || controller.current) return;
    const active = new AbortController();
    controller.current = active;
    const timeout = window.setTimeout(() => active.abort(), 65_000);
    setPending(true);
    setPendingQuestion(replaceId === undefined ? content : "");
    setError("");
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages(history, content), consent: true }),
        signal: active.signal,
      });
      const result: { reply?: unknown; error?: unknown; retryAfter?: unknown; userRemaining?: unknown } = await response.json();
      if (controller.current !== active) return;
      if (typeof result.userRemaining === "number" && Number.isFinite(result.userRemaining)) {
        setRemaining(Math.max(0, result.userRemaining));
      }
      if (!response.ok || typeof result.reply !== "string" || !result.reply.trim()) {
        const description = typeof result.error === "string" ? result.error : "Не удалось получить ответ. Попробуй ещё раз.";
        const retry = typeof result.retryAfter === "number" && result.retryAfter > 0
          ? ` Повтори через ${Math.ceil(result.retryAfter)} сек.` : "";
        throw new Error(description + retry);
      }
      const reply = result.reply;
      if (replaceId === undefined) {
        const question: Message = { id: nextId.current++, role: "user", content };
        const answer: Message = { id: nextId.current++, role: "assistant", content: reply };
        setMessages((previous) => [...previous, question, answer]);
        setDraft("");
      } else {
        setMessages((previous) => previous.map((message) => message.id === replaceId ? { ...message, content: reply } : message));
      }
    } catch (failure) {
      if (controller.current !== active) return;
      setError(active.signal.aborted
        ? "Ответ занял слишком много времени. Текст сохранён — попробуй отправить ещё раз."
        : failure instanceof Error && !(failure instanceof TypeError)
          ? failure.message : "Нет связи с ассистентом. Проверь подключение и попробуй ещё раз.");
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === active) {
        controller.current = null;
        setPending(false);
        setPendingQuestion("");
        if (replaceId === undefined) input.current?.focus({ preventScroll: true });
      }
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
        onClick={() => { setMessages([]); setDraft(""); setError(""); setCopied(null); setCopyError(null); setConsent(false); stickToBottom.current = true; input.current?.focus({ preventScroll: true }); }}>
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
        {pending && <>
          {pendingQuestion && <article className={`${styles.message} ${styles.mine}`}><span className={styles.author}>Ты</span><p className={styles.question}>{pendingQuestion}</p></article>}
          <div className={styles.generating} role="status"><span className={styles.generatingDots} aria-hidden="true"><i /><i /><i /></span><span>Ассистент готовит ответ…</span></div>
        </>}
        <div ref={bottom} />
      </div>

      {showLatest && messages.length > 0 && <button type="button" className={styles.latest} onClick={() => {
        stickToBottom.current = true;
        bottom.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "end" });
      }}><ArrowDown size={15} aria-hidden="true" /> К последнему ответу</button>}

      <form className={styles.composer} onSubmit={send}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!messages.length && <label className={styles.consent}>
          <input type="checkbox" checked={consent} disabled={pending} onChange={(event) => setConsent(event.target.checked)} />
          <span>Я согласен передать текст вопроса и текущего диалога в OpenRouter и внешнюю AI-модель для получения ответа. Другие данные NEXUS не отправляются. <a href="https://openrouter.ai/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a></span>
        </label>}
        <label className="sr-only" htmlFor="ai-question">Твой вопрос</label>
        <textarea id="ai-question" ref={input} value={draft} maxLength={4_000} rows={3} disabled={pending}
          placeholder="Задай вопрос…" aria-describedby="ai-input-help"
          onChange={(event) => setDraft(event.target.value)} />
        <div className={styles.composerFooter}>
          <span id="ai-input-help">{draft.length} / 4000</span>
          <button className="button button-primary" type="submit" disabled={pending || !consent || !draft.trim() || remaining === 0}>
            {pending ? <LoaderCircle className={styles.spinner} size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
            {pending ? "Отправка…" : error ? "Повторить отправку" : "Отправить"}
          </button>
        </div>
        <p className={styles.footnote}>AI может ошибаться — проверяй важные факты. Не отправляй пароли и личные сведения. Диалог исчезнет после обновления страницы.</p>
      </form>
    </>}
  </section>;
}
