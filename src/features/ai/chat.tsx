"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, Check, Copy, Globe, LoaderCircle, Plus, RotateCcw, Send, Settings2, Sparkles, Square, Trash2 } from "lucide-react";
import { AiAnswer } from "./answer";
import { consumeAgentStream } from "./agent/stream";
import { validSources, type Action, type AgentMode, type AgentRequest, type Source } from "./agent/contracts";
import type { AiTurn } from "../../types/ai-database";
import type { Json } from "../../types/database";
import styles from "./ai.module.css";

type Thread = { id: string; title: string; updated_at: string };
type Live = { turnId: string; text: string; sources: Source[]; actions: Action[] };
const modes: [AgentMode, string][] = [["auto", "Авто"], ["quick", "Быстрый ответ"], ["research", "Исследование"], ["solve", "Решение задачи"]];
const describeError = (e: unknown) => e instanceof Error ? e.message : "Не удалось выполнить действие.";
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Сервис временно недоступен.");
  return data as T;
}

export function AiChat({ enabled, dailyLimit, searchEnabled, searchLabel, providerLabel }: { enabled: boolean; dailyLimit: number; searchEnabled: boolean; searchLabel: string; providerLabel: string }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<AgentMode>("auto");
  const [consent, setConsent] = useState(false);
  const [nexusContext, setNexusContext] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [unsaved, setUnsaved] = useState<Live | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryConsent, setMemoryConsent] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState("");
  const [memorySaving, setMemorySaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const uncertain = useRef<AgentRequest | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const selection = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    api<{ threads: Thread[] }>("/api/ai/history", { signal: abort.signal }).then((data) => setThreads(data.threads)).catch((e) => { if (!abort.signal.aborted) setError(describeError(e)); });
    api<{ enabled: boolean; content: string }>("/api/ai/memory", { signal: abort.signal }).then((data) => {
      setMemoryEnabled(data.enabled); setMemoryConsent(data.enabled); setMemoryContent(data.content);
    }).catch(() => {});
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);
  useEffect(() => {
    const update = () => { stickToBottom.current = !bottom.current || bottom.current.getBoundingClientRect().top <= window.innerHeight + 140; setShowLatest(!stickToBottom.current); };
    window.addEventListener("scroll", update, { passive: true }); window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);
  useEffect(() => {
    if (stickToBottom.current) bottom.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [turns, live, pending]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2200); return () => clearTimeout(timer);
  }, [copied]);

  async function refreshThreads() {
    const data = await api<{ threads: Thread[] }>("/api/ai/history"); setThreads(data.threads);
  }
  async function openThread(id: string) {
    if (pending) return;
    const ticket = ++selection.current; setLoading(true); setError("");
    try {
      const data = await api<{ thread: Thread; turns: AiTurn[] }>(`/api/ai/history?id=${encodeURIComponent(id)}`);
      if (ticket !== selection.current) return;
      setActive(id); setTurns(data.turns); setLive(null); setUnsaved(null); setDraft(""); uncertain.current = null; stickToBottom.current = true;
    } catch (e) { if (ticket === selection.current) setError(describeError(e)); }
    finally { if (ticket === selection.current) setLoading(false); }
  }
  function newChat() {
    if (pending) return;
    selection.current++; setLoading(false); setActive(null); setTurns([]); setLive(null); setUnsaved(null); setDraft(""); setError(""); uncertain.current = null;
    stickToBottom.current = true; input.current?.focus();
  }
  async function removeThread(id: string) {
    if (pending || !window.confirm("Удалить этот диалог и его историю?")) return;
    try { await api(`/api/ai/history?id=${encodeURIComponent(id)}`, { method: "DELETE" }); if (active === id) newChat(); await refreshThreads(); }
    catch (e) { setError(describeError(e)); }
  }
  async function saveMemory(event: FormEvent) {
    event.preventDefault(); if (memorySaving) return; setMemorySaving(true); setMemoryStatus("");
    try {
      const data = await api<{ enabled: boolean; content: string }>("/api/ai/memory", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: memoryEnabled, content: memoryContent, consent: memoryConsent }) });
      setMemoryContent(data.content); setMemoryStatus(data.enabled ? "Память сохранена." : "Память выключена, сохранённый текст удалён.");
    } catch (e) { setMemoryStatus(describeError(e)); } finally { setMemorySaving(false); }
  }
  async function ask(question: string, previous?: AiTurn) {
    if (!enabled || !consent || !question.trim() || controller.current || loading) return;
    const request: AgentRequest = uncertain.current?.turnId === previous?.id && uncertain.current ? uncertain.current : {
      threadId: active || crypto.randomUUID(), turnId: previous?.id || crypto.randomUUID(), runId: crypto.randomUUID(),
      question: question.trim(), mode, consent: true, nexusContext,
    };
    uncertain.current = null;
    const abort = new AbortController(); controller.current = abort;
    const timer = window.setTimeout(() => abort.abort("timeout"), 85000);
    setPending(true); setError(""); setStatus("Отправляю вопрос…"); setActive(request.threadId);
    setUnsaved(null);
    setLive({ turnId: request.turnId, text: "", sources: [], actions: [] });
    if (!previous) setTurns((items) => [...items, { id: request.turnId, thread_id: request.threadId, user_id: "", question: request.question, answer: "", mode,
      status: "running", run_id: request.runId, lease_expires_at: new Date(Date.now() + 80000).toISOString(), steps: 0, sources: [], actions: [], usage: {}, error_code: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]);
    let terminal = false;
    const partial: Live = { turnId: request.turnId, text: "", sources: [], actions: [] };
    try {
      const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: abort.signal });
      await consumeAgentStream(response, (event) => {
        if (event.type === "status") setStatus(event.text);
        else if (event.type === "quota") setRemaining(event.remaining);
        else if (event.type === "delta") {
          partial.text += event.text;
          setLive((current) => current ? { ...current, text: current.text + event.text } : current);
        } else if (event.type === "source") {
          partial.sources = [...partial.sources.filter((s) => s.id !== event.source.id), event.source];
          setLive((current) => current ? { ...current, sources: [...current.sources.filter((s) => s.id !== event.source.id), event.source] } : current);
        }
        else if (event.type === "action") setLive((current) => current ? { ...current, actions: [...current.actions.filter((a) => a.id !== event.action.id), event.action] } : current);
        else if (event.type === "done") {
          terminal = true;
          setTurns((items) => items.map((t) => t.id === request.turnId ? { ...t, status: "complete", answer: event.answer, sources: event.sources as unknown as Json, usage: event.usage as unknown as Json, error_code: null } : t));
          setLive(null); setDraft("");
        } else if (event.type === "error") {
          terminal = true; setError(event.message); setLive(null);
          if (event.code === "save_failed" && partial.text) setUnsaved({ ...partial });
          setTurns((items) => items.map((t) => t.id === request.turnId ? { ...t, status: "failed", error_code: event.code } : t));
        }
      });
    } catch (e) {
      if (!abort.signal.aborted && e instanceof TypeError && !terminal) uncertain.current = request;
      if (!abort.signal.aborted && partial.text && !terminal) setUnsaved({ ...partial });
      setError(abort.signal.aborted ? "Генерация остановлена. Можно повторить вопрос; прежний ответ сохранён." : describeError(e));
      setLive(null);
      setTurns((items) => items.map((t) => t.id === request.turnId ? { ...t, status: abort.signal.aborted ? "cancelled" : "failed" } : t));
    } finally {
      clearTimeout(timer); controller.current = null; setPending(false); setStatus("");
      void refreshThreads().catch(() => {}); input.current?.focus({ preventScroll: true });
    }
  }
  async function copy(id: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(id); } catch { setError("Не удалось скопировать. Выдели текст вручную."); }
  }

  return <section className={styles.chat}>
    <header className={styles.heading}>
      <div><h1><Sparkles size={25} aria-hidden="true" /> NEXUS AI</h1><p>Учись, исследуй, превращай вопросы в решения.</p></div>
      <div className={styles.headerActions}>
        <button type="button" className="button button-secondary" onClick={() => setMemoryOpen(!memoryOpen)} aria-expanded={memoryOpen}><Settings2 size={16} /> Память</button>
        <button type="button" className="button button-secondary" disabled={pending} onClick={newChat}><Plus size={16} /> Новый диалог</button>
      </div>
    </header>
    {memoryOpen && <form className={`card ${styles.memory}`} onSubmit={saveMemory}>
      <h2>Что учитывать в ответах</h2><p>Укажи предметы, учебную цель или удобный формат. AI сохраняет только текст, который ты здесь введёшь.</p>
      <label><input type="checkbox" checked={memoryEnabled} onChange={(e) => setMemoryEnabled(e.target.checked)} /> Использовать долгосрочную память</label>
      <textarea aria-label="Текст памяти" rows={3} maxLength={2000} value={memoryContent} disabled={!memoryEnabled || memorySaving} onChange={(e) => setMemoryContent(e.target.value)} placeholder="Например: изучаю Python с нуля, предпочитаю короткие примеры" />
      {memoryEnabled && <label><input type="checkbox" checked={memoryConsent} onChange={(e) => setMemoryConsent(e.target.checked)} /> Разрешаю сохранить этот текст в моём аккаунте и передавать его AI-модели в следующих диалогах.</label>}
      <p>Выключение и сохранение удалит текст памяти. История диалогов удаляется отдельно.</p>
      <button className="button button-secondary" disabled={memorySaving || (memoryEnabled && !memoryConsent)}>{memorySaving ? "Сохранение…" : "Сохранить настройки"}</button>
      {memoryStatus && <p role="status">{memoryStatus}</p>}
    </form>}
    <div className={styles.workspace}>
      <aside className={styles.sidebar} aria-label="История диалогов">
        <div className={styles.sidebarTitle}><h2>Диалоги</h2><button type="button" onClick={() => void refreshThreads().catch((e) => setError(describeError(e)))} aria-label="Обновить историю"><RotateCcw size={14} /></button></div>
        {!threads.length && <p className={styles.historyEmpty}>Здесь появятся сохранённые диалоги.</p>}
        {threads.map((thread) => <div key={thread.id} className={`${styles.thread} ${active === thread.id ? styles.activeThread : ""}`}>
          <button type="button" disabled={pending || loading} onClick={() => void openThread(thread.id)} title={thread.title}>{thread.title}</button>
          <button type="button" disabled={pending || loading} aria-label={`Удалить диалог: ${thread.title}`} onClick={() => void removeThread(thread.id)}><Trash2 size={14} /></button>
        </div>)}
      </aside>
      <div className={styles.main}>
        {!enabled && <p className={styles.error}>Ассистент пока не подключён. Сохранённая история доступна ниже.</p>}
        <div className={styles.capabilities}><span><Globe size={14} /> {searchEnabled ? "Поиск подключён" : "Поиск не подключён"}</span><span>{remaining === null ? `До ${dailyLimit} обращений к модели в сутки` : `Осталось обращений: ${remaining}`}</span></div>
        <p className={styles.limit}>Один сложный вопрос может потребовать несколько обращений.</p>
        {loading && <p role="status">Загружаю диалог…</p>}
        <div className={styles.conversation} aria-label="Диалог с NEXUS AI" aria-busy={pending || loading}>
          {!turns.length && <div className={styles.welcome}><span className={styles.sparkle}><Sparkles size={28} /></span><h2>Что разберём сегодня?</h2><p>От первого объяснения до плана, который можно выполнить.</p>
            <div className={styles.suggestions}>{["Составь план изучения Python на месяц: 2 часа в день", "Помоги найти ошибку в коде", "Объясни тему и проверь, как я её понял"].map((s) => <button type="button" key={s} onClick={() => { setDraft(s); input.current?.focus(); }}>{s}</button>)}</div>
          </div>}
          {turns.map((turn, index) => {
            const current = live?.turnId === turn.id ? live : null;
            const text = current?.text || turn.answer;
            const sources = validSources(current?.text ? current.sources : turn.sources);
            return <div key={turn.id} className={styles.turn}>
              <article className={`${styles.message} ${styles.mine}`}><span className={styles.author}>Ты</span><p className={styles.question}>{turn.question}</p></article>
              {current && current.actions.length > 0 && <ul className={styles.activity} aria-label="Действия агента">{current.actions.map((a) => <li key={a.id}>{a.status === "running" ? <LoaderCircle size={13} className={styles.spinner} /> : a.status === "complete" ? <Check size={13} /> : <span>×</span>} {a.label}{a.status === "error" ? " — недоступно" : ""}</li>)}</ul>}
              {text && <article className={`${styles.message} ${styles.answer}`}><span className={styles.author}>NEXUS AI</span><AiAnswer content={text} sourceUrls={sources.map((s) => s.url)} />
                {sources.length > 0 && <div className={styles.sources} aria-label="Источники">{sources.map((s) => <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"><Globe size={13} /><span>{s.title}{s.published && <small>{s.published}</small>}</span></a>)}</div>}
                <div className={styles.answerActions}><button className={styles.copy} type="button" onClick={() => void copy(turn.id, text)}>{copied === turn.id ? <Check size={14} /> : <Copy size={14} />}{copied === turn.id ? "Скопировано" : "Копировать"}</button>
                  {index === turns.length - 1 && <button className={styles.copy} type="button" disabled={pending || !consent || !enabled || remaining === 0} onClick={() => void ask(turn.question, turn)}><RotateCcw size={14} /> Повторить ответ</button>}
                </div>
              </article>}
              {!text && !current && <p className={styles.interrupted}>{turn.status === "running" ? "Запрос ещё выполняется. Обнови диалог позже." : "Ответ не завершён."}
                {index === turns.length - 1 && <button className={styles.copy} type="button" disabled={pending || !consent || !enabled || remaining === 0} onClick={() => void ask(turn.question, turn)}><RotateCcw size={14} /> Повторить</button>}
              </p>}
            </div>;
          })}
          {unsaved && <article className={`${styles.message} ${styles.answer}`}>
            <span className={styles.author}>Несохранённый ответ</span>
            <AiAnswer content={unsaved.text} sourceUrls={validSources(unsaved.sources).map((source) => source.url)} />
            <button className={styles.copy} type="button" onClick={() => void copy("unsaved", unsaved.text)}><Copy size={14} />{copied === "unsaved" ? "Скопировано" : "Копировать несохранённый ответ"}</button>
          </article>}
          {pending && <p className={styles.generating} role="status"><LoaderCircle className={styles.spinner} size={16} /> {status || "Готовлю ответ…"}</p>}
          <div ref={bottom} />
        </div>
        {turns.at(-1)?.answer && !pending && <div className={styles.followups}>{["Объясни проще", "Проверь выводы и ограничения", "Дай практическое задание"].map((s) => <button type="button" key={s} onClick={() => { setDraft(s); input.current?.focus(); }}>{s}</button>)}</div>}
        {showLatest && <button className={styles.latest} type="button" onClick={() => { stickToBottom.current = true; bottom.current?.scrollIntoView({ behavior: "instant", block: "end" }); }}><ArrowDown size={14} /> К последнему ответу</button>}
        <form className={styles.composer} onSubmit={(e) => {
          e.preventDefault(); const last = turns.at(-1);
          void ask(draft, last && last.status !== "complete" && last.question === draft.trim() ? last : undefined);
        }}>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.modes} role="group" aria-label="Режим ответа">{modes.map(([key, label]) => <button type="button" key={key} aria-pressed={mode === key} disabled={pending} onClick={() => setMode(key)}>{label}</button>)}</div>
          {mode === "research" && !searchEnabled && <p className={styles.footnote}>Поиск пока не подключён. Агент сможет разобрать тему и ссылки из вопроса, но не проверить свежие новости поиском.</p>}
          {!consent && <label className={styles.consent}><input type="checkbox" checked={consent} disabled={pending} onChange={(e) => setConsent(e.target.checked)} /><span>Разрешаю передавать вопрос, контекст диалога и разрешённые данные инструментов в {providerLabel} и внешнюю AI-модель. {searchEnabled && `При поиске запрос получает ${searchLabel}. `}История сохраняется в моём аккаунте.</span></label>}
          <label className={styles.consent}><input type="checkbox" checked={nexusContext} disabled={pending} onChange={(e) => setNexusContext(e.target.checked)} /><span>Разрешить AI использовать мой учебный профиль, список моих сообществ и общую ленту NEXUS для этого запроса.</span></label>
          <label className="sr-only" htmlFor="ai-question">Твой вопрос</label><textarea id="ai-question" ref={input} rows={3} maxLength={4000} value={draft} disabled={pending || loading || !enabled} placeholder="Задай вопрос…" onChange={(e) => setDraft(e.target.value)} />
          <div className={styles.composerFooter}><span>{draft.length} / 4000</span>{pending ? <button type="button" className="button button-secondary" onClick={() => controller.current?.abort()}><Square size={15} /> Остановить</button> : <button type="submit" className="button button-primary" disabled={!enabled || !consent || !draft.trim() || loading || remaining === 0}><Send size={16} /> Отправить</button>}</div>
          <p className={styles.footnote}>AI может ошибаться. Проверяй важные факты и не отправляй пароли. Ссылки в ответах доступны, когда они получены инструментами.</p>
        </form>
      </div>
    </div>
  </section>;
}
