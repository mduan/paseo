import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import React from "react";
import {
  CircleDot,
  FileText,
  GitPullRequest,
  MessageSquareCode,
  MousePointer2,
} from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { ComposerAttachment, WorkspaceComposerAttachment } from "@/attachments/types";
import { getFileTypeLabel } from "@/attachments/file-types";
import {
  isPullRequestContextAttachment,
  isWorkspaceAttachment,
  getPullRequestContextSubtitle,
} from "@/attachments/workspace-attachment-utils";
import { getWorkspaceFileAttachmentSubtitle } from "@/attachments/workspace-file";
import { getForgePresentation } from "@/git/forge";
import { resolvePluginIcon } from "@/plugins/icons";
import { ICON_SIZE, type Theme } from "@/styles/theme";

export interface AttachmentPillContent {
  icon: ReactNode;
  title: string;
  subtitle: string;
}

export function getComposerAttachmentPillContent(
  attachment: Exclude<ComposerAttachment, { kind: "image" }>,
  t: TFunction,
): AttachmentPillContent {
  if (isWorkspaceAttachment(attachment)) {
    return getWorkspaceAttachmentPillContent(attachment, t);
  }
  if (attachment.kind === "file") {
    return getAgentAttachmentPillContent(attachment.attachment, t);
  }
  if (attachment.kind === "workspace_file") {
    return {
      icon: attachmentFileIcon,
      title: attachment.path.split("/").pop() ?? attachment.path,
      subtitle: getWorkspaceFileAttachmentSubtitle(attachment),
    };
  }
  if (attachment.kind === "plugin_resource") {
    const Icon = resolvePluginIcon(attachment.sourceIcon);
    return {
      icon: <ThemedResourceIcon Icon={Icon} uniProps={iconForegroundMutedMapping} />,
      title: attachment.item.title,
      subtitle: `${attachment.sourceTitle} ${attachment.item.identifier}`,
    };
  }
  const item = attachment.item;
  const presentation = getForgePresentation(item.forge ?? "github");
  const isChangeRequest = item.kind === "change_request";
  const kind = isChangeRequest ? presentation.changeRequestAbbrev : "Issue";
  const prefix = isChangeRequest ? presentation.numberPrefix : presentation.issueNumberPrefix;
  return {
    icon: isChangeRequest ? attachmentGithubPrIcon : attachmentGithubIssueIcon,
    title: item.title,
    subtitle: `${kind} ${prefix}${item.number}`,
  };
}

function getReviewSubtitle(count: number, t: TFunction): string {
  return count === 1
    ? t("message.attachments.commentsOne")
    : t("message.attachments.commentsMany", { count });
}

function getTextAttachmentSubtitle(
  attachment: Extract<AgentAttachment, { type: "text" }>,
  t: TFunction,
): string {
  if (attachment.contextKind === "chat_history") {
    return "Previous conversation";
  }
  return t("message.attachments.text");
}

export function getAgentAttachmentPillContent(
  attachment: AgentAttachment,
  t: TFunction,
): AttachmentPillContent {
  switch (attachment.type) {
    case "review":
      return {
        icon: attachmentReviewIcon,
        title: t("message.attachments.review"),
        subtitle: getReviewSubtitle(attachment.comments.length, t),
      };
    case "forge_change_request": {
      const presentation = getForgePresentation(attachment.forge ?? "github");
      return {
        icon: attachmentGithubPrIcon,
        title: attachment.title,
        subtitle: `${presentation.changeRequestAbbrev} ${presentation.numberPrefix}${attachment.number}`,
      };
    }
    case "github_pr":
      return {
        icon: attachmentGithubPrIcon,
        title: attachment.title,
        subtitle: `PR #${attachment.number}`,
      };
    case "forge_issue":
    case "github_issue":
      return {
        icon: attachmentGithubIssueIcon,
        title: attachment.title,
        subtitle: `Issue #${attachment.number}`,
      };
    case "text":
      if (attachment.externalResource) {
        return {
          icon:
            attachment.externalResource.provider === "forge"
              ? attachmentFileIcon
              : attachmentGithubIssueIcon,
          title: attachment.externalResource.title,
          subtitle:
            `${attachment.externalResource.providerLabel} ${attachment.externalResource.identifier}`.trim(),
        };
      }
      return {
        icon: attachmentFileIcon,
        title: attachment.title ?? t("message.attachments.textAttachment"),
        subtitle: getTextAttachmentSubtitle(attachment, t),
      };
    case "uploaded_file":
      return {
        icon: attachmentFileIcon,
        title: attachment.fileName,
        subtitle: getFileTypeLabel(attachment.fileName) ?? t("message.attachments.file"),
      };
  }
}

export function getWorkspaceAttachmentPillContent(
  attachment: WorkspaceComposerAttachment,
  t: TFunction,
): AttachmentPillContent {
  if (attachment.kind === "browser_element") {
    return {
      icon: attachmentBrowserIcon,
      title: attachment.attachment.tag,
      subtitle: t("composer.attachments.element"),
    };
  }
  if (isPullRequestContextAttachment(attachment)) {
    return {
      icon: attachmentFileIcon,
      title: attachment.title,
      subtitle: getPullRequestContextSubtitle(attachment),
    };
  }
  if (attachment.kind === "chat_history") {
    return {
      icon: attachmentFileIcon,
      title: attachment.attachment.title ?? t("message.attachments.textAttachment"),
      subtitle: getTextAttachmentSubtitle(attachment.attachment, t),
    };
  }
  return {
    icon: attachmentReviewIcon,
    title: t("message.attachments.review"),
    subtitle: getReviewSubtitle(attachment.commentCount, t),
  };
}

const ThemedAttachmentFileText = withUnistyles(FileText);
const ThemedAttachmentGitPullRequest = withUnistyles(GitPullRequest);
const ThemedAttachmentCircleDot = withUnistyles(CircleDot);
const ThemedAttachmentMessageSquareCode = withUnistyles(MessageSquareCode);
const ThemedAttachmentMousePointer = withUnistyles(MousePointer2);

function ResourceIcon({
  Icon,
  color = "",
}: {
  Icon: ReturnType<typeof resolvePluginIcon>;
  color?: string;
}) {
  return <Icon size={ICON_SIZE.sm} color={color} />;
}

const ThemedResourceIcon = withUnistyles(ResourceIcon);

const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const attachmentReviewIcon = (
  <ThemedAttachmentMessageSquareCode size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
);
const attachmentGithubPrIcon = (
  <ThemedAttachmentGitPullRequest size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
);
const attachmentGithubIssueIcon = (
  <ThemedAttachmentCircleDot size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
);
const attachmentFileIcon = (
  <ThemedAttachmentFileText size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
);
const attachmentBrowserIcon = (
  <ThemedAttachmentMousePointer size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
);
