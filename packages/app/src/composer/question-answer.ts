import { Buffer } from "buffer";
import {
  renderPromptAttachmentAsText,
  type QuestionAnswerContext,
} from "@getpaseo/protocol/prompt-attachments";
import type { AttachmentStore, ComposerAttachment } from "@/attachments/types";
import { uploadFileAttachments, type ComposerSendClient } from "./actions";
import { splitComposerAttachmentsForSubmit } from "./attachments/submit";

// Synchronous question APIs accept only strings, so they still need uploaded paths.
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
}): Promise<{ answer: string; context: QuestionAnswerContext }> {
  const split = splitComposerAttachmentsForSubmit(attachments);
  const imageInputs = await Promise.all(
    split.images.map(async (image) => ({
      data: await store.encodeBase64({ attachment: image }),
      mimeType: image.mimeType,
    })),
  );
  const uploadedImages = await uploadFileAttachments({
    client,
    files: split.images.map((image, index) => ({
      fileName: image.fileName || `image.${image.mimeType.split("/")[1]}`,
      mimeType: image.mimeType,
      readBytes: async () => Buffer.from(imageInputs[index].data, "base64"),
    })),
  });
  const context = [...uploadedImages.map((image) => image.attachment), ...split.attachments].map(
    renderPromptAttachmentAsText,
  );
  return {
    answer: [text.trim(), ...context].filter(Boolean).join("\n\n"),
    context: {
      text: text.trim(),
      images: uploadedImages.map((image) => image.attachment),
      ...(imageInputs.length ? { imageInputs } : {}),
      attachments: split.attachments,
    },
  };
}
