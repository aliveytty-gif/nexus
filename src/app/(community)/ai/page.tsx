import { requireUser } from "@/lib/auth/session";
import { AiChat } from "@/features/ai/chat";
import { readAgentConfig } from "@/features/ai/agent/config";
import "katex/dist/katex.min.css";

export const metadata = { title: "NEXUS AI" };

export default async function AiPage() {
  const user = await requireUser("/ai");
  const config = readAgentConfig(process.env);
  return <AiChat key={user.id} enabled={config.enabled && config.ready} dailyLimit={config.userLimit}
    searchEnabled={config.searchEnabled} searchLabel={config.searchProvider === "firecrawl" ? "Firecrawl" : "Brave Search"}
    providerLabel={config.provider === "openrouter" ? "OpenRouter" : config.provider === "groq" ? "Groq" : config.provider} />;
}
