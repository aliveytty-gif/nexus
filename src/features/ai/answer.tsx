"use client";

import { Children, isValidElement, memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import styles from "./ai.module.css";

const highlighter = createLowlight({ javascript, typescript, python, json, css, xml, bash, sql });
const languages: Record<string, { grammar: string; label: string }> = {
  javascript: { grammar: "javascript", label: "JavaScript" },
  js: { grammar: "javascript", label: "JavaScript" },
  jsx: { grammar: "javascript", label: "JSX" },
  typescript: { grammar: "typescript", label: "TypeScript" },
  ts: { grammar: "typescript", label: "TypeScript" },
  tsx: { grammar: "typescript", label: "TSX" },
  python: { grammar: "python", label: "Python" },
  py: { grammar: "python", label: "Python" },
  json: { grammar: "json", label: "JSON" },
  css: { grammar: "css", label: "CSS" },
  html: { grammar: "xml", label: "HTML" },
  xml: { grammar: "xml", label: "XML" },
  bash: { grammar: "bash", label: "Bash" },
  sh: { grammar: "bash", label: "Shell" },
  shell: { grammar: "bash", label: "Shell" },
  sql: { grammar: "sql", label: "SQL" },
};

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

// Lowlight produces an AST; only escaped text and syntax spans reach React.
function renderToken(node: unknown, key: number): ReactNode {
  if (!node || typeof node !== "object") return null;
  const token = node as {
    type?: unknown;
    value?: unknown;
    tagName?: unknown;
    properties?: { className?: unknown };
    children?: unknown[];
  };
  if (token.type === "text" && typeof token.value === "string") return token.value;
  if (token.type !== "element" || token.tagName !== "span" || !Array.isArray(token.children)) return null;
  const classes = Array.isArray(token.properties?.className)
    ? token.properties.className.filter((name): name is string => typeof name === "string" && /^[a-zA-Z0-9_-]+$/.test(name)).join(" ")
    : undefined;
  return <span key={key} className={classes}>{token.children.map(renderToken)}</span>;
}

const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const selected = Object.hasOwn(languages, language) ? languages[language] : undefined;
  const highlighted = useMemo(() => {
    if (!selected || code.length > 12_000) return code;
    try {
      return highlighter.highlight(selected.grammar, code).children.map(renderToken);
    } catch {
      return code;
    }
  }, [code, selected]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2_500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return <div className={styles.codeFrame}>
    <div className={styles.codeHeader}>
      <span className={styles.codeLanguage}>{selected?.label || language.slice(0, 32) || "Текст"}</span>
      <button className={styles.codeCopy} type="button" onClick={() => void copy()}
        aria-label={copyState === "copied" ? "Код скопирован" : "Скопировать код"}
        title={copyState === "error" ? "Не удалось скопировать. Выдели код вручную." : "Скопировать код"}>
        {copyState === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        <span aria-live="polite">{copyState === "copied" ? "Скопировано" : copyState === "error" ? "Не удалось" : "Копировать"}</span>
      </button>
    </div>
    <pre className={styles.codeContent} tabIndex={0} aria-label="Блок кода"><code>{highlighted}</code></pre>
  </div>;
});

const markdownComponents: Components = {
  a: ({ href, children }) => {
    const safe = href ? safeUrl(href) : "";
    return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
  },
  img: ({ src, alt }) => {
    const safe = typeof src === "string" ? safeUrl(src) : "";
    return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{alt || "Открыть изображение"}</a> : <span>{alt || "Изображение"}</span>;
  },
  pre: ({ children }) => {
    const child = Children.toArray(children).find((value) => isValidElement(value));
    if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return <pre>{children}</pre>;
    const code = typeof child.props.children === "string" ? child.props.children.replace(/\n$/, "") : "";
    const language = /\blanguage-([a-z0-9_+-]+)/i.exec(child.props.className || "")?.[1].toLowerCase() || "";
    return <CodeBlock code={code} language={language} />;
  },
  table: ({ children }) => <div className={styles.tableScroll} role="region" tabIndex={0} aria-label="Таблица из ответа AI"><table>{children}</table></div>,
};

const markdownPlugins = [remarkGfm];

export const AiAnswer = memo(function AiAnswer({ content }: { content: string }) {
  return <div className={styles.markdown}>
    <Markdown skipHtml urlTransform={safeUrl} remarkPlugins={markdownPlugins} components={markdownComponents}>{content}</Markdown>
  </div>;
});
