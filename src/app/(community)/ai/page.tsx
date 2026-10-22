import { requireUser } from "@/lib/auth/session";
import { AiChat } from "@/features/ai/chat";
import { getAiConfig } from "@/features/ai/config";

export const metadata = { title: "NEXUS AI" };

export default async function AiPage() {
  await requireUser("/ai");
  const config = getAiConfig();
  return <AiChat enabled={config.enabled && config.ready} dailyLimit={config.userLimit} />;
}
