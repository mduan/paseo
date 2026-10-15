import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import { getComposerAttachmentPillContent } from "@/attachments/attachment-pill-content";
import type { ComposerAttachment } from "@/attachments/types";
import type { PluginResourceComposerAttachment } from "./model";

interface PluginResourceAttachmentPillProps {
  attachment: PluginResourceComposerAttachment;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
  openLabel: (kind: string, identifier: string) => string;
  removeLabel: (kind: string, identifier: string) => string;
}

export function PluginResourceAttachmentPill({
  attachment,
  index,
  disabled,
  onOpen,
  onRemove,
  openLabel,
  removeLabel,
}: PluginResourceAttachmentPillProps) {
  const { t } = useTranslation();
  const content = getComposerAttachmentPillContent(attachment, t);
  const handleOpen = useCallback(() => onOpen(attachment), [attachment, onOpen]);
  const handleRemove = useCallback(() => onRemove(index), [index, onRemove]);
  return (
    <AttachmentPill
      testID="composer-plugin-resource-attachment-pill"
      onOpen={handleOpen}
      onRemove={handleRemove}
      openAccessibilityLabel={openLabel(attachment.sourceTitle, attachment.item.identifier)}
      removeAccessibilityLabel={removeLabel(attachment.sourceTitle, attachment.item.identifier)}
      disabled={disabled}
    >
      <AttachmentLabel icon={content.icon} title={content.title} subtitle={content.subtitle} />
    </AttachmentPill>
  );
}
