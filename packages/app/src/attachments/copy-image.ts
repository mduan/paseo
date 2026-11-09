import { Buffer } from "buffer";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AttachmentMetadata } from "./types";
import { getAttachmentStore } from "./store";
import { resolveAssistantImageSource } from "@/utils/assistant-image-source";
import { copyImageToClipboard } from "@/utils/image-clipboard";

// eslint-disable-next-line typescript/consistent-type-definitions -- AGENTS.md prefers type aliases.
type CopyImageInput = {
  image?: AttachmentMetadata;
  source?: string;
  client?: DaemonClient | null;
};

export async function copyMessageImage({ image, source, client }: CopyImageInput): Promise<void> {
  await copyImageToClipboard(async () => {
    if (image) {
      const store = await getAttachmentStore();
      const base64 = await store.encodeBase64({ attachment: image });
      return `data:${image.mimeType};base64,${base64}`;
    }
    const resolution = resolveAssistantImageSource({ source: source ?? "" });
    if (!resolution) throw new Error("No image available to copy.");
    if (resolution.kind === "direct") return resolution.uri;
    if (!client) throw new Error("Host unavailable while copying image.");
    const file = await client.readFile(resolution.cwd, resolution.path);
    if (file.kind !== "image") throw new Error("The image is no longer available.");
    return `data:${file.mime};base64,${Buffer.from(file.bytes).toString("base64")}`;
  });
}
