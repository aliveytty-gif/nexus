// A bounded arithmetic parser: no eval, Function, imports, properties, or executable code.
export function calculate(expression: string) {
  if (!expression.trim() || expression.length > 256) throw new Error("Выражение должно содержать 1–256 символов.");
  const tokens = expression.match(/\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|[a-z]+|[+\-*/^()%]|\S/gi) || [];
  if (tokens.length > 128) throw new Error("Слишком сложное выражение.");
  let index = 0;
  const functions: Record<string, (x: number) => number> = {
    sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    log: Math.log, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  };
  const safe = (value: number) => {
    if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error("Результат вне безопасного диапазона или выражение не определено.");
    return value;
  };
  function parse(min = 0, depth = 0): number {
    if (depth > 24) throw new Error("Слишком глубокие скобки.");
    const token = tokens[index++];
    let left: number;
    if (token === "+" || token === "-") left = (token === "-" ? -1 : 1) * parse(3, depth + 1);
    else if (token === "(") {
      left = parse(0, depth + 1);
      if (tokens[index++] !== ")") throw new Error("Проверь скобки.");
    } else if (token === "pi" || token === "e") left = token === "pi" ? Math.PI : Math.E;
    else if (Object.hasOwn(functions, token || "")) {
      if (tokens[index++] !== "(") throw new Error("Для функции нужны скобки.");
      left = functions[token](parse(0, depth + 1));
      if (tokens[index++] !== ")") throw new Error("Проверь скобки.");
    } else if (token && /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) left = Number(token);
    else throw new Error("Допустимы только числа, арифметика и разрешённые функции.");
    safe(left);
    while (index < tokens.length) {
      const op = tokens[index];
      const precedence = op === "+" || op === "-" ? 1 : ["*", "/", "%"].includes(op) ? 2 : op === "^" ? 4 : -1;
      if (precedence < min) break;
      index++;
      const right = parse(precedence + (op === "^" ? 0 : 1), depth + 1);
      if (op === "^" && Math.abs(right) > 128) throw new Error("Слишком большая степень.");
      left = safe(op === "+" ? left + right : op === "-" ? left - right : op === "*" ? left * right : op === "/" ? left / right : op === "%" ? left % right : left ** right);
    }
    return safe(left);
  }
  const value = parse();
  if (index !== tokens.length) throw new Error("Проверь выражение.");
  return { expression, value: Number(value.toPrecision(14)), precision: "Численная арифметика, до 14 значащих цифр. Углы в радианах; % — остаток от деления." };
}
