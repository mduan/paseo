import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { ComposerAttachment } from "@/attachments/types";
import { isHttpUrl } from "@/utils/http-url";

export function getAttachmentLink(
  attachment: ComposerAttachment | AgentAttachment,
): string | undefined {
  let url: string | undefined;
  if ("item" in attachment) {
    url = attachment.item.url;
  } else if ("url" in attachment) {
    url = attachment.url ?? undefined;
  } else if ("type" in attachment && attachment.type === "text") {
    url = attachment.externalResource?.url;
  }
  return url && isHttpUrl(url) ? url : undefined;
}
