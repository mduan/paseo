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
  isSnapshotDiffComparison,
  isTurnDiffComparison,
  type CheckoutDiffComparison,
  type CommitRange,
  type TurnDiffComparison,
  type WorkingDiffComparison,
} from "@/git/working-diff-comparison/state";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
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
    commitRange,
    selectUncommitted,
    selectBase,
    selectAll,
    turnModes,
    selectCommitRange,
  } = useResolvedDiffComparison({ serverId, workspaceId, cwd, isDirty: hasUncommittedChanges });

  const checkoutDiff = useCheckoutDiffQuery({
    serverId,
    cwd,
    mode: checkoutMode,
    includeUncommitted,
    baseRef,
    ignoreWhitespace,
    enabled: enabled && isGit && !turnComparison && !commitRange,
    queryScope,
  });
  const snapshotDiff = useSnapshotDiff({
    serverId,
    workspaceId,
    cwd,
    turnComparison,
    commitRange,
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
    snapshotDiff,
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
    snapshot: snapshotDiff?.snapshot,
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
    commitRange,
    selectCommitRange,
    files: expansion.files,
    onExpandGap: expansion.onExpandGap,
    ...selectDiffState({ snapshotDiff, checkoutDiff, reviewActions }),
  };
}

function selectDiffState<ReviewActions>(input: {
  snapshotDiff: ReturnType<typeof useSnapshotDiff>;
  checkoutDiff: ReturnType<typeof useCheckoutDiffQuery>;
  reviewActions: ReviewActions;
}) {
  const { snapshotDiff, checkoutDiff, reviewActions } = input;
  if (snapshotDiff) {
    return {
      commentsCapabilityMissing: snapshotDiff.commentsCapabilityMissing,
      isTurnSnapshotMissing: snapshotDiff.isSnapshotMissing,
      diffPayloadError: snapshotDiff.payloadError,
      diffTooLarge: snapshotDiff.diffTooLarge,
      isDiffLoading: snapshotDiff.isLoading,
      historyStatus: undefined,
      retryHistory: undefined,
      reviewActions: snapshotDiff.snapshot ? reviewActions : undefined,
    };
  }
  return {
    commentsCapabilityMissing: false,
    isTurnSnapshotMissing: false,
    diffPayloadError: checkoutDiff.payloadError,
    diffTooLarge: checkoutDiff.diffTooLarge,
    isDiffLoading: checkoutDiff.isLoading,
    historyStatus: checkoutDiff.historyStatus,
    retryHistory: checkoutDiff.retryHistory,
    reviewActions,
  };
}

/**
 * The selected comparison. Turn and commit range comparisons apply only while the host supports
 * them; otherwise the checkout falls back to its dirty-state default.
 */
function useResolvedDiffComparison(input: {
  serverId: string;
  workspaceId?: string;
  cwd: string;
  isDirty: boolean;
}) {
  const { comparison, commitRange, selectComparison } = useWorkingDiffComparison(input);
  const turnDiffsEnabled = useTurnDiffsEnabled(input.serverId);
  // COMPAT(commitRangeDiff): added in v0.11.0-fork.40, remove after 2027-05-13.
  const commitRangeSupported = useHostFeature(input.serverId, "commitRangeDiff");
  const selectCommitRange = useMemo(
    () =>
      commitRangeSupported
        ? (range: CommitRange) => selectComparison("commit_range", range)
        : undefined,
    [commitRangeSupported, selectComparison],
  );
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
  const defaultCheckoutMode: CheckoutDiffComparison = input.isDirty ? "uncommitted" : "base";
  const checkoutMode = isSnapshotDiffComparison(comparison) ? defaultCheckoutMode : comparison;
  const resolvedCheckoutMode = checkoutMode === LiveDiffComparison.All ? "base" : checkoutMode;
  const turnComparison = turnDiffsEnabled && isTurnDiffComparison(comparison) ? comparison : null;
  const activeCommitRange = commitRangeSupported ? commitRange : undefined;
  const diffMode: WorkingDiffComparison =
    turnComparison ?? (activeCommitRange ? "commit_range" : checkoutMode);
  return {
    diffMode,
    checkoutMode: resolvedCheckoutMode,
    includeUncommitted,
    turnComparison,
    commitRange: activeCommitRange,
    selectUncommitted,
    selectBase,
    selectAll,
    turnModes,
    selectCommitRange,
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
  snapshotDiff: { cwd: string; scopeKey: string; files: ParsedDiffFile[] } | null;
  checkoutFiles: ParsedDiffFile[];
}) {
  const { serverId, snapshotDiff } = input;
  return useDiffContextExpansion({
    serverId,
    ...(snapshotDiff
      ? {
          cwd: snapshotDiff.cwd,
          scopeKey: `${snapshotDiff.scopeKey}:${input.ignoreWhitespace}`,
          files: snapshotDiff.files,
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
    scopeKey: `turn:${input.serverId}:${agentId}:${input.comparison}`,
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

/** The selected turn or commit range diff, or null for a live checkout comparison. */
function useSnapshotDiff(input: {
  serverId: string;
  workspaceId?: string;
  cwd: string;
  turnComparison: TurnDiffComparison | null;
  commitRange: CommitRange | undefined;
  ignoreWhitespace: boolean;
  enabled: boolean;
}) {
  const { serverId, cwd, turnComparison, commitRange, ignoreWhitespace, enabled } = input;
  const turnDiff = useTurnComparisonDiff({
    serverId,
    workspaceId: input.workspaceId,
    comparison: turnComparison,
    ignoreWhitespace,
    enabled,
  });
  const commitRangeDiff = useCommitRangeComparisonDiff({
    serverId,
    cwd,
    commitRange,
    ignoreWhitespace,
    enabled,
  });
  if (turnComparison) return turnDiff;
  return commitRange ? commitRangeDiff : null;
}

/** The combined diff of a commit range, in the same shape as the turn snapshot diff. */
function useCommitRangeComparisonDiff(input: {
  serverId: string;
  cwd: string;
  commitRange: CommitRange | undefined;
  ignoreWhitespace: boolean;
  enabled: boolean;
}) {
  const { serverId, cwd, commitRange, ignoreWhitespace } = input;
  const client = useHostRuntimeClient(serverId);
  const query = useFetchQuery({
    queryKey: ["checkout-commit-range-diff", serverId, cwd, commitRange, ignoreWhitespace],
    queryFn: () => {
      if (!client || !commitRange) throw new Error("Host disconnected");
      return client.getCommitRangeDiff({ cwd, ...commitRange, ignoreWhitespace });
    },
    enabled: input.enabled && Boolean(client) && Boolean(commitRange),
    dataShape: "value",
    // Commits are immutable, so a range's diff never changes.
    immutableWhen: () => true,
  });
  const payload = commitRange ? query.data : undefined;
  const queryError = query.error
    ? { code: "UNKNOWN" as const, message: query.error.message }
    : null;
  return {
    scopeKey: `commits:${serverId}:${cwd}:${commitRange?.fromSha}..${commitRange?.toSha}`,
    cwd,
    files: payload?.files ?? EMPTY_FILES,
    snapshot: payload?.snapshot,
    commentsCapabilityMissing: false,
    payloadError: payload?.error ?? queryError,
    diffTooLarge: payload?.diffTooLarge === true,
    isLoading: !payload && !query.error,
    isSnapshotMissing: false,
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
