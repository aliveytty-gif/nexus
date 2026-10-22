import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { regenerationContext, requestMessages, type ChatMessage } from "../src/features/ai/chat-history.ts";

// Transpile the production component; only its CSS import needs a Node substitute.
// Keeping the fixture below tests/ preserves normal dependency resolution.
async function loadAnswer() {
  const directory = await mkdtemp(fileURLToPath(new URL(".tmp-ai-answer-", import.meta.url)));
  try {
    const source = (await readFile(new URL("../src/features/ai/answer.tsx", import.meta.url), "utf8"))
      .replace('import styles from "./ai.module.css";', 'const styles = new Proxy({}, { get: (_, key) => String(key) });');
    const output = ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const filename = `${directory}/answer.mjs`;
    await writeFile(filename, output);
    return (await import(pathToFileURL(filename).href)).AiAnswer as ComponentType<{ content: string }>;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const AiAnswer = await loadAnswer();
const render = (content: string) => renderToStaticMarkup(createElement(AiAnswer, { content }));
const pair = (id: number, size = 4): ChatMessage[] => [
  { id, role: "user", content: `q${id}`.padEnd(size, "q") },
  { id: id + 1, role: "assistant", content: `a${id}`.padEnd(size, "a") },
];

describe("AI bounded and regeneration history", () => {
  it("keeps recent complete pairs within seven messages and 12000 characters", () => {
    for (const size of [4, 3000, 4000]) {
      const original = [...pair(1, size), ...pair(3, size), ...pair(5, size), ...pair(7, size)];
      const snapshot = structuredClone(original);
      const result = requestMessages(original, "follow-up");
      assert.ok(result.length <= 7);
      assert.equal(result.length % 2, 1);
      assert.ok(result.reduce((sum, message) => sum + message.content.length, 0) <= 12000);
      assert.deepEqual(result.at(-1), { role: "user", content: "follow-up" });
      result.forEach((message, index) => assert.equal(message.role, index % 2 ? "assistant" : "user"));
      const kept = result.length > 1 ? original.slice(-(result.length - 1)) : [];
      assert.deepEqual(result.slice(0, -1), kept.map(({ role, content }) => ({ role, content })));
      assert.deepEqual(original, snapshot);
    }
  });

  it("starts a fresh request without previous messages", () => {
    assert.deepEqual(requestMessages([], "Вопрос"), [{ role: "user", content: "Вопрос" }]);
  });

  it("regenerates the final question with earlier conversation preserved and old answer excluded", () => {
    const messages = [...pair(1), ...pair(3), ...pair(5)];
    const snapshot = structuredClone(messages);
    const context = regenerationContext(messages);
    assert.ok(context);
    assert.deepEqual(context.question, messages[4]);
    assert.deepEqual(context.answer, messages[5]);
    assert.deepEqual(context.history, messages.slice(0, 4));
    assert.deepEqual(requestMessages(context.history, context.question.content),
      messages.slice(0, 5).map(({ role, content }) => ({ role, content })));
    assert.deepEqual(messages, snapshot);
    assert.deepEqual(regenerationContext(pair(1))?.history, []);
  });

  it("refuses regeneration without a final user/assistant pair", () => {
    for (const messages of [[], pair(1).slice(0, 1), pair(1).slice(1), [...pair(1), pair(3)[0]],
      [pair(1)[1], pair(3)[1]], [pair(1)[0], pair(3)[0]]]) {
      assert.equal(regenerationContext(messages), null);
    }
  });
});

describe("AI production Markdown renderer", () => {
  it("renders headings, ordered and unordered lists, inline code and GFM tables", () => {
    const html = render("## Ответ\n\n- Один\n- Два\n\n1. Шаг\n2. Ещё\n\n`inline`\n\n| Язык | Пример |\n| --- | --- |\n| JS | const |\n");
    for (const tag of ["h2", "ul", "ol", "li", "code", "table", "thead", "tbody", "th", "td"])
      assert.match(html, new RegExp(`<${tag}(?:>| )`));
    assert.match(html, /aria-label="Таблица из ответа AI"/);
  });

  it("highlights all eight supported language grammars and labels code controls", () => {
    const examples = [
      ["javascript", "JavaScript", "const answer = 42;"],
      ["typescript", "TypeScript", "const answer: number = 42;"],
      ["python", "Python", "def answer(): return 42"],
      ["json", "JSON", '{"answer":42}'],
      ["css", "CSS", ".answer { color: red; }"],
      ["html", "HTML", '<div class="answer">Hi</div>'],
      ["bash", "Bash", 'echo "$HOME"'],
      ["sql", "SQL", "SELECT answer FROM examples;"],
    ];
    for (const [language, label, code] of examples) {
      const html = render(`\`\`\`${language}\n${code}\n\`\`\``);
      assert.ok(html.includes(label), language);
      assert.match(html, /class="hljs-/, language);
      assert.match(html, /aria-label="Скопировать код"/, language);
      assert.match(html, /<pre[^>]*tabindex="0"/, language);
    }
  });

  it("drops raw HTML, unsafe URLs and image elements while preserving safe external links", () => {
    const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[bad](javascript:alert%281%29)\n\n![bad](data:image/svg+xml;base64,PHN2Zz4=)\n\n![remote](https://example.com/pixel.png)\n\n[good](https://example.com/help)');
    assert.doesNotMatch(html, /<script\b|<img\b|onerror=|href="(?:javascript|data):/i);
    assert.match(html, /href="https:\/\/example.com\/help"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    assert.match(html, /href="https:\/\/example.com\/pixel.png"/);
    assert.match(html, />bad<\/span>/);
  });

  it("shows unknown languages and long code as escaped plain text", () => {
    for (const [language, code] of [["unknown-language", '<script>alert("x")</script>'],
      ["javascript", "const answer = 1;\n".repeat(800)]]) {
      const html = render(`\`\`\`${language}\n${code}\n\`\`\``);
      assert.doesNotMatch(html, /class="hljs-|<script\b/);
      assert.ok(html.includes(language === "javascript" ? "JavaScript" : language));
      assert.ok(html.includes(language === "javascript" ? "const answer = 1;" : "&lt;script&gt;"));
      assert.equal((html.match(/<pre\b/g) || []).length, 1);
    }
  });
});
