import { UUID_PATTERN } from "@/features/posts/validation";
import { MESSAGE_LINK_TTL, readMessageAttachments } from "@/features/messages/data";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string; index: string }> },
) {
  const { messageId, index } = await params;
  const unavailable = () => new Response("Вложение недоступно.", { status: 404, headers });
  if (!UUID_PATTERN.test(messageId) || !/^[0-9]$/.test(index) || !(await getCurrentUser()))
    return unavailable();

  const supabase = await createClient();
  // Only a published message visible to this session can supply the file path.
  const { data: message, error } = await supabase.from("messages")
    .select("attachments, attachment_path, attachment_name, attachment_type, attachment_size")
    .eq("id", messageId).maybeSingle();
  if (error || !message) return unavailable();

  let attachment;
  try {
    attachment = readMessageAttachments(message)[Number(index)];
  } catch {
    return unavailable();
  }
  if (!attachment) return unavailable();

  const json = new URL(request.url).searchParams.get("format") === "json";
  const { data, error: signingError } = await supabase.storage.from("message-files")
    .createSignedUrl(attachment.path, MESSAGE_LINK_TTL, { download: json ? false : attachment.name });
  if (signingError || !data?.signedUrl) return unavailable();

  if (json) return Response.json({ url: data.signedUrl }, { headers });
  return new Response(null, {
    status: 307,
    headers: { ...headers, Location: data.signedUrl },
  });
}
