export type ChatMessage = { id: number; role: "user" | "assistant"; content: string };

export function requestMessages(messages: ChatMessage[], content: string) {
  const previous: { role: "user" | "assistant"; content: string }[] = [];
  let characters = content.length;
  for (let index = messages.length - 2; index >= Math.max(0, messages.length - 6); index -= 2) {
    const question = messages[index].content.slice(0, 4000);
    const answer = messages[index + 1].content.slice(0, 4000);
    if (characters + question.length + answer.length > 12000) break;
    previous.unshift({ role: "user", content: question }, { role: "assistant", content: answer });
    characters += question.length + answer.length;
  }
  return [...previous, { role: "user" as const, content }];
}

export function regenerationContext(messages: ChatMessage[]) {
  const question = messages.at(-2);
  const answer = messages.at(-1);
  if (question?.role !== "user" || answer?.role !== "assistant") return null;
  return { question, answer, history: messages.slice(0, -2) };
}
