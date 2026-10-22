"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, LoaderCircle, Plus, Send, Sparkles } from "lucide-react";
import Markdown from "react-markdown";
import styles from "./ai.module.css";

type Message = { id: number; role: "user" | "assistant"; content: string };

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function requestMessages(messages: Message[], content: string) {
  const previous: { role: "user" | "assistant"; content: string }[] = [];
  let characters = content.length;
  for (let index = messages.length - 2; index >= Math.max(0, messages.length - 6); index -= 2) {
    const question = messages[index].content.slice(0, 4_000);
    const answer = messages[index + 1].content.slice(0, 4_000);
    if (characters + question.length + answer.length > 12_000) break;
    previous.unshift({ role: "user", content: question }, { role: "assistant", content: answer });
    characters += question.length + answer.length;
  }
  return [...previous, { role: "user" as const, content }];
}

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
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => {
    const active = controller.current;
    controller.current = null;
    active?.abort();
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [messages.length, pending]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!enabled || !consent || !content || content.length > 4_000 || controller.current) return;
    const active = new AbortController();
    controller.current = active;
    const timeout = window.setTimeout(() => active.abort(), 65_000);
    setPending(true);
    setPendingQuestion(content);
    setError("");
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages(messages, content), consent: true }),
        signal: active.signal,
      });
      const result: { reply?: unknown; error?: unknown; retryAfter?: unknown; userRemaining?: unknown } = await response.json();
      if (typeof result.userRemaining === "number" && Number.isFinite(result.userRemaining)) {
        setRemaining(Math.max(0, result.userRemaining));
      }
      if (!response.ok || typeof result.reply !== "string" || !result.reply.trim()) {
        const description = typeof result.error === "string" ? result.error : "Не удалось получить ответ. Попробуй ещё раз.";
        const retry = typeof result.retryAfter === "number" && result.retryAfter > 0
          ? ` Повтори через ${Math.ceil(result.retryAfter)} сек.` : "";
        throw new Error(description + retry);
      }
      const question: Message = { id: nextId.current++, role: "user", content };
      const answer: Message = { id: nextId.current++, role: "assistant", content: result.reply };
      setMessages((previous) => [...previous, question, answer]);
      setDraft("");
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
        input.current?.focus();
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
        onClick={() => { setMessages([]); setDraft(""); setError(""); setCopied(null); setCopyError(null); setConsent(false); input.current?.focus(); }}>
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
            <div className={styles.markdown}><Markdown skipHtml urlTransform={safeUrl} components={{
              a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
              img: ({ src, alt }) => typeof src === "string" && safeUrl(src) ? <a href={safeUrl(src)} target="_blank" rel="noopener noreferrer">{alt || "Открыть изображение"}</a> : <span>{alt || "Изображение"}</span>,
            }}>{message.content}</Markdown></div>
            <button type="button" className={styles.copy} onClick={() => void copy(message)} aria-label="Скопировать ответ">
              {copied === message.id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copied === message.id ? "Скопировано" : "Копировать"}
            </button>
            {copyError === message.id && <p className={styles.copyError} role="status">Не удалось скопировать. Выдели текст ответа вручную.</p>}
          </>}
        </article>)}
        {pending && <>
          <article className={`${styles.message} ${styles.mine}`}><span className={styles.author}>Ты</span><p className={styles.question}>{pendingQuestion}</p></article>
          <p className={styles.generating} role="status"><LoaderCircle size={18} aria-hidden="true" /> Ассистент готовит ответ…</p>
        </>}
        <div ref={bottom} />
      </div>

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
