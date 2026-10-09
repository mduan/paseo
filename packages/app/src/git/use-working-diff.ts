import { useCallback, useEffect, useMemo } from "react";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import {
  buildReviewDraftKey,
  useInlineReviewController,
  useReviewAttachmentSnapshot,
  type ReviewDraftMode,
} from "@/review";
import { buildDiffReviewContext } from "@/review/context";
import type { ReviewLineRange } from "@/review/range";
import { useDiffContextExpansion } from "@/git/diff-context-expansion";
import { useCheckoutDiffQuery } from "@/git/use-diff-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useWorkingDiffComparison } from "@/git/working-diff-comparison";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import {
  LiveDiffComparison,
  isTurnDiffComparison,
  type CheckoutDiffComparison,
  type TurnDiffComparison,
  type WorkingDiffComparison,
} from "@/git/working-diff-comparison/state";
import { useHostFeature } from "@/runtime/host-features";
import { useFocusedChatTarget } from "@/panels/use-add-file-to-chat";
import { useAgentTurnDiff, useTurnDiffsEnabled } from "@/turn-diffs/queries";
import { toErrorMessage } from "@/utils/error-messages";

const LAST_TURN_TARGET = { kind: "last_turn" } as const;

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
    error: statusError,
  } = useCheckoutStatusQuery({ serverId, cwd });
  const gitStatus = status && status.isGit ? status : null;
  const isGit = Boolean(gitStatus);
  const notGit = status !== null && !status.isGit && !status.error;
  const statusErrorMessage = status?.error?.message ?? (statusError && toErrorMessage(statusError));
  const baseRef = gitStatus?.baseRef ?? undefined;
  const hasUncommittedChanges = Boolean(gitStatus?.isDirty);
  const currentBranchName =
    gitStatus?.currentBranch && gitStatus.currentBranch !== "HEAD" ? gitStatus.currentBranch : null;

  const {
    diffMode,
    checkoutMode,
    includeUncommitted,
    turnComparison,
    selectUncommitted,
    selectBase,
    selectAll,
    turnModes,
  } = useResolvedDiffComparison({ serverId, workspaceId, cwd, isDirty: hasUncommittedChanges });

  const checkoutDiff = useCheckoutDiffQuery({
    serverId,
    cwd,
    mode: checkoutMode,
    includeUncommitted,
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
  const { reviewDraftKey } = useReviewDraftScope({ serverId, workspaceId, cwd });
  const expansion = useWorkingDiffExpansion({
    serverId,
    cwd,
    ignoreWhitespace,
    reviewDraftKey,
    checkoutMode,
    includeUncommitted,
    baseRef,
    turnComparison,
    turnDiff,
    checkoutFiles: checkoutDiff.files,
  });
  // Expanded lines give review comments on them their surrounding context.
  const diffFiles = expansion.files;
  const buildContext = useCallback(
    (range: ReviewLineRange) => buildDiffReviewContext({ range, diffFiles }),
    [diffFiles],
  );
  const reviewActions = useInlineReviewController({
    reviewDraftKey,
    buildContext,
    snapshot: turnDiff.snapshot,
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
    selectAll,
    turnModes,
    commentsCapabilityMissing: turnDiff.commentsCapabilityMissing,
    ...(turnComparison
      ? {
          isTurnSnapshotMissing: turnDiff.isSnapshotMissing,
          files: expansion.files,
          onExpandGap: expansion.onExpandGap,
          diffPayloadError: turnDiff.payloadError,
          diffTooLarge: turnDiff.diffTooLarge,
          isDiffLoading: turnDiff.isLoading,
          reviewActions: turnDiff.snapshot ? reviewActions : undefined,
        }
      : {
          isTurnSnapshotMissing: false,
          files: expansion.files,
          onExpandGap: expansion.onExpandGap,
          diffPayloadError: checkoutDiff.payloadError,
          diffTooLarge: checkoutDiff.diffTooLarge,
          isDiffLoading: checkoutDiff.isLoading,
          reviewActions,
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
  // COMPAT(checkoutCombinedDiff): added in v0.11.0-fork.6, remove after 2027-04-08.
  const combinedDiffSupported = useHostFeature(input.serverId, "checkoutCombinedDiff");
  const selectAllChanges = useCallback(
    () => selectComparison(LiveDiffComparison.All),
    [selectComparison],
  );
  const selectAll = combinedDiffSupported ? selectAllChanges : undefined;
  const includeUncommitted = comparison === LiveDiffComparison.All;
  const selectUncommitted = useCallback(() => selectComparison("uncommitted"), [selectComparison]);
  const selectBase = useCallback(() => selectComparison("base"), [selectComparison]);
  const turnModes = useMemo(
    () => (turnDiffsEnabled ? { selectLastTurn: () => selectComparison("last_turn") } : null),
    [selectComparison, turnDiffsEnabled],
  );
  const isTurn = isTurnDiffComparison(comparison);
  const defaultCheckoutMode: CheckoutDiffComparison = input.isDirty ? "uncommitted" : "base";
  const checkoutMode = isTurn ? defaultCheckoutMode : comparison;
  const resolvedCheckoutMode = checkoutMode === LiveDiffComparison.All ? "base" : checkoutMode;
  const turnComparison = turnDiffsEnabled && isTurn ? comparison : null;
  const diffMode: WorkingDiffComparison = turnComparison ?? checkoutMode;
  return {
    diffMode,
    checkoutMode: resolvedCheckoutMode,
    includeUncommitted,
    turnComparison,
    selectUncommitted,
    selectBase,
    selectAll,
    turnModes,
  };
}

const EMPTY_FILES: ParsedDiffFile[] = [];

function useWorkingDiffExpansion(input: {
  serverId: string;
  cwd: string;
  ignoreWhitespace: boolean;
  reviewDraftKey: string;
  checkoutMode: CheckoutDiffComparison;
  includeUncommitted: boolean;
  baseRef?: string;
  turnComparison: TurnDiffComparison | null;
  turnDiff: { cwd: string; agentId: string | null; files: ParsedDiffFile[] };
  checkoutFiles: ParsedDiffFile[];
}) {
  const { serverId, turnComparison, turnDiff } = input;
  return useDiffContextExpansion({
    serverId,
    ...(turnComparison
      ? {
          cwd: turnDiff.cwd,
          scopeKey: `turn:${serverId}:${turnDiff.agentId}:${turnComparison}:${input.ignoreWhitespace}`,
          files: turnDiff.files,
        }
      : {
          cwd: input.cwd,
          // Expanded gaps belong to one checkout comparison.
          scopeKey: `${input.reviewDraftKey}:mode=${input.checkoutMode}:includeUncommitted=${input.includeUncommitted}:base=${input.baseRef ?? ""}:ignoreWhitespace=${input.ignoreWhitespace}`,
          files: input.checkoutFiles,
        }),
  });
}

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
    target: LAST_TURN_TARGET,
    ignoreWhitespace: input.ignoreWhitespace,
    enabled: input.enabled && input.comparison !== null,
  });
  const payload = input.comparison ? query.data : undefined;
  const queryError = query.error
    ? { code: "UNKNOWN" as const, message: query.error.message }
    : null;
  return {
    agentId,
    cwd: payload?.cwd ?? "",
    files: payload?.files ?? EMPTY_FILES,
    snapshot: payload?.snapshot,
    commentsCapabilityMissing: Boolean(payload?.files.length && !payload.snapshot),
    payloadError: payload?.error ?? queryError,
    diffTooLarge: payload?.diffTooLarge === true,
    isLoading: Boolean(agentId) && !payload && !query.error,
    isSnapshotMissing: !agentId || payload?.available === false,
  };
}

export interface ReviewDraftScope {
  reviewDraftKey: string;
  isGit: boolean;
  mode: ReviewDraftMode;
  includeUncommitted: boolean;
  baseRef?: string;
}

/**
 * The workspace's review draft key, plus the checkout comparison the diff pane resolves, which
 * the review attachment reports.
 */
export function useReviewDraftScope({
  serverId,
  workspaceId,
  cwd,
}: {
  serverId: string;
  workspaceId?: string;
  cwd: string;
}): ReviewDraftScope {
  const { status } = useCheckoutStatusQuery({ serverId, cwd });
  const gitStatus = status && status.isGit ? status : null;
  const baseRef = gitStatus?.baseRef ?? undefined;
  const { checkoutMode, includeUncommitted } = useResolvedDiffComparison({
    serverId,
    workspaceId,
    cwd,
    isDirty: Boolean(gitStatus?.isDirty),
  });
  const reviewDraftKey = useMemo(
    () => buildReviewDraftKey({ serverId, workspaceId, cwd }),
    [cwd, serverId, workspaceId],
  );
  return {
    reviewDraftKey,
    isGit: Boolean(gitStatus),
    mode: checkoutMode,
    includeUncommitted,
    baseRef,
  };
}

/** Publishes the workspace's review comments as one composer attachment. Mount once per workspace. */
export function usePublishReviewAttachment({
  serverId,
  workspaceId,
  cwd,
}: {
  serverId: string;
  workspaceId?: string;
  cwd: string;
}) {
  const scope = useReviewDraftScope({ serverId, workspaceId, cwd });
  const attachment = useReviewAttachmentSnapshot({
    key: scope.reviewDraftKey,
    cwd,
    mode: scope.mode,
    includeUncommitted: scope.includeUncommitted,
    baseRef: scope.baseRef,
  });
  const scopeKey = useMemo(
    () => buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd }),
    [cwd, serverId, workspaceId],
  );
  const setReviewAttachment = useWorkspaceAttachmentsStore((state) => state.setReviewAttachment);

  useEffect(() => {
    if (!scope.isGit) {
      return;
    }
    setReviewAttachment({ scopeKey, attachment });
    return () => setReviewAttachment({ scopeKey, attachment: null });
  }, [attachment, scope.isGit, scopeKey, setReviewAttachment]);
}
