import type { ActiveTurnBehavior } from "@getpaseo/protocol/messages";
import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";

export type ImageAttachment = AttachmentMetadata;

export interface MessagePayload {
  text: string;
  attachments: ComposerAttachment[];
  cwd: string;
  forceSend?: boolean;
  /** Overrides the default send behavior for this message while the agent is running. */
  activeTurnBehavior?: ActiveTurnBehavior;
}

export interface TextReplacement {
  key: string;
  text: string;
}
