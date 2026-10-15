import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { ReviewAttachment } from "@getpaseo/protocol/messages";
import { getAgentAttachmentPillContent } from "@/attachments/attachment-pill-content";
import { AttachmentFrame, AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { MarkdownLinkText } from "@/components/markdown/link-text";
import { FileActionsContextMenuContent } from "@/components/file-actions-menu";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { FloatingScrollView } from "@/components/ui/floating";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import { reviewLineLabel } from "@/review/range";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useToast } from "@/contexts/toast-api-context";

// oxlint-disable-next-line typescript-eslint/consistent-type-definitions
type ReviewAttachmentPillProps = {
  attachment: ReviewAttachment;
  onOpen?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  testID?: string;
};

export function ReviewAttachmentPill({
  attachment,
  onOpen,
  onRemove,
  disabled,
  testID,
}: ReviewAttachmentPillProps) {
  const { t } = useTranslation();
  const { openFileInWorkspace } = usePaneContext();
  const { isPaneFocused, isWorkspaceFocused } = usePaneFocus();
  const active = useRetainedPanelActive();
  const compact = useIsCompactFormFactor();
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const enabled = active && isPaneFocused && isWorkspaceFocused && !disabled;
  const useSheet = isNative || compact;
  const content = getAgentAttachmentPillContent(attachment, t);

  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  const close = useCallback(() => setOpen(false), []);
  const show = useCallback(() => {
    if (!enabled) return;
    if (useSheet || !onOpen) setOpen(true);
    else onOpen();
  }, [enabled, onOpen, useSheet]);
  const header = useMemo(() => ({ title: content.subtitle }), [content.subtitle]);
  const scrollStyle = useMemo(() => ({ maxHeight: Math.min(440, height - 32) }), [height]);

  const label = (
    <AttachmentLabel icon={content.icon} title={content.title} subtitle={content.subtitle} />
  );
  const pill = onRemove ? (
    <AttachmentPill
      onOpen={show}
      onRemove={onRemove}
      disabled={disabled}
      openAccessibilityLabel={t("composer.attachments.openReview")}
      removeAccessibilityLabel={t("composer.attachments.removeReview")}
      testID={testID}
    >
      {label}
    </AttachmentPill>
  ) : (
    <AttachmentFrame
      onPress={show}
      accessibilityLabel={t("composer.attachments.openReview")}
      testID={testID}
    >
      {label}
    </AttachmentFrame>
  );
  const rows = attachment.comments.map((comment, index) => (
    <ReviewCommentRow
      key={JSON.stringify(comment)}
      comment={comment}
      cwd={attachment.cwd}
      divider={index > 0}
      onClose={close}
      onOpenFile={openFileInWorkspace}
    />
  ));

  if (useSheet) {
    return (
      <>
        {pill}
        <AdaptiveModalSheet visible={open && enabled} onClose={close} header={header}>
          {rows}
        </AdaptiveModalSheet>
      </>
    );
  }

  return (
    <Tooltip open={open && enabled} onOpenChange={setOpen} enabledOnDesktop={enabled} interactive>
      <TooltipTrigger asChild disabled={disabled}>
        <View>{pill}</View>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        maxWidth={Math.min(520, width - 16)}
        style={styles.popover}
        testID="review-comments-popover"
      >
        <FloatingScrollView style={scrollStyle}>{rows}</FloatingScrollView>
      </TooltipContent>
    </Tooltip>
  );
}

// oxlint-disable-next-line typescript-eslint/consistent-type-definitions
type ReviewCommentRowProps = {
  comment: ReviewAttachment["comments"][number];
  cwd: string;
  divider: boolean;
  onClose: () => void;
  onOpenFile: ReturnType<typeof usePaneContext>["openFileInWorkspace"];
};

function ReviewCommentRow({ comment, cwd, divider, onClose, onOpenFile }: ReviewCommentRowProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const copyPath = useCallback(() => {
    void copyToClipboard(comment.filePath)
      .then(() => toast.copied())
      .catch(() => toast.error(t("desktop.contextMenu.actionFailed")));
  }, [comment.filePath, t, toast]);
  const openFile = useCallback(() => {
    const paths = resolveWorkspaceFilePaths({ path: comment.filePath, workspaceRoot: cwd });
    if (!paths) return;
    onClose();
    onOpenFile({
      location: {
        path: paths.absolutePath,
        lineStart: comment.startLineNumber ?? comment.lineNumber,
        lineEnd: comment.lineNumber,
      },
      disposition: "preferred",
    });
  }, [comment, cwd, onClose, onOpenFile]);
  return (
    <View style={[styles.row, divider && styles.divider]}>
      <ContextMenu>
        <ContextMenuTrigger contextOnly>
          <View style={styles.file}>
            <MaterialFileIcon fileName={comment.filePath} size={16} />
            <MarkdownLinkText style={styles.link} onPress={openFile}>
              {comment.filePath}
            </MarkdownLinkText>
          </View>
        </ContextMenuTrigger>
        <FileActionsContextMenuContent fileKind="file" onCopyRelativePath={copyPath} />
      </ContextMenu>
      <Text style={styles.location}>
        {comment.startLineNumber
          ? `${reviewLineLabel({ side: comment.startSide ?? comment.side, lineNumber: comment.startLineNumber })} – `
          : ""}
        {reviewLineLabel(comment)}
      </Text>
      <Text selectable style={styles.body}>
        {comment.body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  popover: { paddingVertical: 0, paddingHorizontal: 0, width: 520 },
  row: { padding: theme.spacing[3], gap: theme.spacing[2] },
  divider: { borderTopWidth: 1, borderColor: theme.colors.border },
  file: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[2] },
  link: { color: theme.colors.accentBright, fontSize: theme.fontSize.base, flexShrink: 1 },
  location: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  body: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
}));
