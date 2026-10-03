import { useCallback, useEffect, useMemo } from "react";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import {
  buildReviewDraftKey,
  useInlineReviewController,
  useReviewAttachmentSnapshot,
} from "@/review";
import { useCheckoutDiffQuery } from "@/git/use-diff-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useWorkingDiffComparison } from "@/git/working-diff-comparison";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import {
  isTurnDiffComparison,
  type CheckoutDiffComparison,
  type TurnDiffComparison,
  type WorkingDiffComparison,
} from "@/git/working-diff-comparison/state";
import { useFocusedChatTarget } from "@/panels/use-add-file-to-chat";
import { useAgentTurnDiff, useTurnDiffsEnabled } from "@/turn-diffs/queries";

const LAST_TURN_TARGET = { kind: "last_turn" } as const;
const SESSION_TARGET = { kind: "session" } as const;

interface UseWorkingDiffOptions {
  serverId: string;
  workspaceId?: string;
  cwd: string;
  ignoreWhitespace: boolean;
  enabled: boolean;
  queryScope?: string;
}

export function useWorkingDiff({
  serverId,
  workspaceId,
  cwd,
  ignoreWhitespace,
  enabled,
  queryScope,
}: UseWorkingDiffOptions) {
  const {
    status,
    isLoading: isStatusLoading,
    isError: isStatusError,
    error: statusError,
  } = useCheckoutStatusQuery({ serverId, cwd });
  const gitStatus = status && status.isGit ? status : null;
  const isGit = Boolean(gitStatus);
  const notGit = status !== null && !status.isGit && !status.error;
  const statusErrorMessage =
    status?.error?.message ??
    (isStatusError && statusError instanceof Error ? statusError.message : null);
  const baseRef = gitStatus?.baseRef ?? undefined;
  const hasUncommittedChanges = Boolean(gitStatus?.isDirty);
  const currentBranchName =
    gitStatus?.currentBranch && gitStatus.currentBranch !== "HEAD" ? gitStatus.currentBranch : null;

  const { diffMode, checkoutMode, turnComparison, selectUncommitted, selectBase, turnModes } =
    useResolvedDiffComparison({ serverId, workspaceId, cwd, isDirty: hasUncommittedChanges });

  const checkoutDiff = useCheckoutDiffQuery({
    serverId,
    cwd,
    mode: checkoutMode,
    baseRef,
    ignoreWhitespace,
    enabled: enabled && isGit && !turnComparison,
    queryScope,
  });
  const turnDiff = useTurnComparisonDiff({
    serverId,
    workspaceId,
    comparison: turnComparison,
    ignoreWhitespace,
    enabled: enabled && isGit,
  });
  const reviewDraftKey = useMemo(
    () =>
      buildReviewDraftKey({
        serverId,
        workspaceId,
        cwd,
        mode: checkoutMode,
        baseRef,
        ignoreWhitespace,
      }),
    [baseRef, checkoutMode, cwd, ignoreWhitespace, serverId, workspaceId],
  );
  const reviewActions = useInlineReviewController({ reviewDraftKey });
  const reviewAttachment = useReviewAttachmentSnapshot({
    key: reviewDraftKey,
    diffFiles: checkoutDiff.files,
    cwd,
    mode: checkoutMode,
    baseRef,
  });

  return {
    status,
    isStatusLoading,
    isGit,
    notGit,
    statusErrorMessage,
    baseRef,
    currentBranchName,
    diffMode,
    selectUncommitted,
    selectBase,
    turnModes,
    ...(turnComparison
      ? {
          isTurnSnapshotMissing: turnDiff.isSnapshotMissing,
          files: turnDiff.files,
          diffPayloadError: turnDiff.payloadError,
          diffTooLarge: turnDiff.diffTooLarge,
          isDiffLoading: turnDiff.isLoading,
          // Turn snapshots are frozen; reviews act on the live checkout only.
          reviewActions: undefined,
          reviewAttachment: null,
        }
      : {
          isTurnSnapshotMissing: false,
          files: checkoutDiff.files,
          diffPayloadError: checkoutDiff.payloadError,
          diffTooLarge: checkoutDiff.diffTooLarge,
          isDiffLoading: checkoutDiff.isLoading,
          reviewActions,
          reviewAttachment,
        }),
  };
}

/**
 * The selected comparison. Turn comparisons apply only while turn diffs are enabled; otherwise
 * the checkout falls back to its dirty-state default.
 */
function useResolvedDiffComparison(input: {
  serverId: string;
  workspaceId?: string;
  cwd: string;
  isDirty: boolean;
}) {
  const { comparison, selectComparison } = useWorkingDiffComparison(input);
  const turnDiffsEnabled = useTurnDiffsEnabled(input.serverId);
  const selectUncommitted = useCallback(() => selectComparison("uncommitted"), [selectComparison]);
  const selectBase = useCallback(() => selectComparison("base"), [selectComparison]);
  const turnModes = useMemo(
    () =>
      turnDiffsEnabled
        ? {
            selectLastTurn: () => selectComparison("last_turn"),
            selectSession: () => selectComparison("session"),
          }
        : null,
    [selectComparison, turnDiffsEnabled],
  );
  const isTurn = isTurnDiffComparison(comparison);
  const defaultCheckoutMode: CheckoutDiffComparison = input.isDirty ? "uncommitted" : "base";
  const checkoutMode = isTurn ? defaultCheckoutMode : comparison;
  const turnComparison = turnDiffsEnabled && isTurn ? comparison : null;
  const diffMode: WorkingDiffComparison = turnComparison ?? checkoutMode;
  return { diffMode, checkoutMode, turnComparison, selectUncommitted, selectBase, turnModes };
}

const EMPTY_FILES: ParsedDiffFile[] = [];

/** The focused agent's frozen turn snapshot, in the same shape as the checkout diff. */
function useTurnComparisonDiff(input: {
  serverId: string;
  workspaceId?: string;
  comparison: TurnDiffComparison | null;
  ignoreWhitespace: boolean;
  enabled: boolean;
}) {
  const agentId = useFocusedChatTarget(input)?.agentId ?? null;
  const query = useAgentTurnDiff({
    serverId: input.serverId,
    agentId,
    target: input.comparison === "session" ? SESSION_TARGET : LAST_TURN_TARGET,
    ignoreWhitespace: input.ignoreWhitespace,
    enabled: input.enabled && input.comparison !== null,
  });
  const payload = query.data;
  const queryError = query.error
    ? { code: "UNKNOWN" as const, message: query.error.message }
    : null;
  return {
    files: payload?.files ?? EMPTY_FILES,
    payloadError: payload?.error ?? queryError,
    diffTooLarge: payload?.diffTooLarge === true,
    isLoading: Boolean(agentId) && !payload && !query.error,
    isSnapshotMissing: !agentId || payload?.available === false,
  };
}

export function usePublishWorkingDiffAttachment({
  serverId,
  workspaceId,
  cwd,
  attachment,
  enabled,
}: {
  serverId: string;
  workspaceId?: string;
  cwd: string;
  attachment: ReturnType<typeof useWorkingDiff>["reviewAttachment"];
  enabled: boolean;
}) {
  const scopeKey = useMemo(
    () => buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd }),
    [cwd, serverId, workspaceId],
  );
  const setWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.setWorkspaceAttachments,
  );
  const clearWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.clearWorkspaceAttachments,
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const attachments = attachment ? [attachment] : [];
    setWorkspaceAttachments({ scopeKey, attachments });
    return () => {
      const current = useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey];
      if (current === attachments) {
        clearWorkspaceAttachments({ scopeKey });
      }
    };
  }, [attachment, clearWorkspaceAttachments, enabled, scopeKey, setWorkspaceAttachments]);
}
