import { Buffer } from "buffer";
import { renderPromptAttachmentAsText } from "@getpaseo/protocol/prompt-attachments";
import type { AttachmentStore, ComposerAttachment } from "@/attachments/types";
import { uploadFileAttachments, type ComposerSendClient } from "./actions";
import { splitComposerAttachmentsForSubmit } from "./attachments/submit";

// Provider question APIs accept strings, so images travel as files the agent can open.
export async function buildQuestionAttachmentAnswer({
  text,
  attachments,
  client,
  store,
}: {
  text: string;
  attachments: ComposerAttachment[];
  client: Pick<ComposerSendClient, "uploadFile">;
  store: Pick<AttachmentStore, "encodeBase64">;
}): Promise<string> {
  const split = splitComposerAttachmentsForSubmit(attachments);
  const uploadedImages = await uploadFileAttachments({
    client,
    files: split.images.map((image) => ({
      fileName: image.fileName || `image.${image.mimeType.split("/")[1]}`,
      mimeType: image.mimeType,
      readBytes: async () => Buffer.from(await store.encodeBase64({ attachment: image }), "base64"),
    })),
  });
  const context = [...uploadedImages.map((image) => image.attachment), ...split.attachments].map(
    renderPromptAttachmentAsText,
  );
  return [text.trim(), ...context].filter(Boolean).join("\n\n");
}
