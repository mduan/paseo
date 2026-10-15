import type {
  ComposerAttachment,
  PullRequestContextAttachment,
  UserComposerAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import { getAttachmentLink } from "@/attachments/link";

export function getPullRequestContextSubtitle(attachment: PullRequestContextAttachment): string {
  if (
    attachment.kind === "forge.change_request_check" ||
    attachment.kind === "github.pull_request_check"
  ) {
    return "Check logs";
  }
  if (
    attachment.kind === "forge.change_request_comment" ||
    attachment.kind === "github.pull_request_comment"
  ) {
    return "Comment";
  }
  return "Review";
}

export function isPullRequestContextAttachment(
  attachment: ComposerAttachment | undefined,
): attachment is PullRequestContextAttachment {
  return (
    attachment?.kind === "forge.change_request_comment" ||
    attachment?.kind === "forge.change_request_review" ||
    attachment?.kind === "forge.change_request_check" ||
    attachment?.kind === "github.pull_request_comment" ||
    attachment?.kind === "github.pull_request_review" ||
    attachment?.kind === "github.pull_request_check"
  );
}

export function isWorkspaceAttachment(
  attachment: ComposerAttachment | undefined,
): attachment is WorkspaceComposerAttachment {
  return (
    attachment?.kind === "review" ||
    attachment?.kind === "browser_element" ||
    attachment?.kind === "chat_history" ||
    isPullRequestContextAttachment(attachment)
  );
}

export function userAttachmentsOnly(
  attachments: readonly ComposerAttachment[],
): UserComposerAttachment[] {
  return attachments.filter(
    (attachment): attachment is UserComposerAttachment =>
      attachment.kind !== "review" &&
      attachment.kind !== "browser_element" &&
      attachment.kind !== "chat_history" &&
      !isPullRequestContextAttachment(attachment),
  );
}

export function workspaceAttachmentToSubmitAttachment(
  attachment: ComposerAttachment,
): AgentAttachment | null {
  if (attachment.kind === "browser_element") {
    return {
      type: "text",
      mimeType: "text/plain",
      title: `Browser element · ${attachment.attachment.tag}`,
      text: attachment.attachment.formatted,
    };
  }
  if (isPullRequestContextAttachment(attachment)) {
    const url = getAttachmentLink(attachment);
    return {
      type: "text",
      mimeType: "text/plain",
      title: attachment.title,
      text: attachment.text,
      ...(url
        ? {
            externalResource: {
              provider: "forge",
              providerLabel: getPullRequestContextSubtitle(attachment),
              resourceType: attachment.kind,
              id: attachment.id,
              identifier: "",
              title: attachment.title,
              url,
            },
          }
        : {}),
    };
  }
  if (attachment.kind === "chat_history") {
    return attachment.attachment;
  }
  return attachment.kind === "review" ? attachment.attachment : null;
}
