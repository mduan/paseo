import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { LinkAttachmentPill } from "@/components/link-attachment-pill";
import { getComposerAttachmentPillContent } from "@/attachments/attachment-pill-content";
import type { PluginResourceComposerAttachment } from "./model";

interface PluginResourceAttachmentPillProps {
  attachment: PluginResourceComposerAttachment;
  index: number;
  disabled: boolean;
  onRemove: (index: number) => void;
  openLabel: (kind: string, identifier: string) => string;
  removeLabel: (kind: string, identifier: string) => string;
}

export function PluginResourceAttachmentPill({
  attachment,
  index,
  disabled,
  onRemove,
  openLabel,
  removeLabel,
}: PluginResourceAttachmentPillProps) {
  const { t } = useTranslation();
  const content = getComposerAttachmentPillContent(attachment, t);
  const handleRemove = useCallback(() => onRemove(index), [index, onRemove]);
  return (
    <LinkAttachmentPill
      testID="composer-plugin-resource-attachment-pill"
      url={attachment.item.url}
      content={content}
      onRemove={handleRemove}
      accessibilityLabel={openLabel(attachment.sourceTitle, attachment.item.identifier)}
      removeAccessibilityLabel={removeLabel(attachment.sourceTitle, attachment.item.identifier)}
      disabled={disabled}
    />
  );
}
