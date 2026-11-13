export enum LiveDiffComparison {
  All = "all",
}

export type CheckoutDiffComparison = "uncommitted" | "base";
/** Frozen snapshots of the focused agent's turns; they don't follow the dirty state. */
export type TurnDiffComparison = "last_turn";
/** A contiguous range of the checkout's commits, stored as `CommitRange` on the override. */
export type CommitRangeComparison = "commit_range";
export type WorkingDiffComparison =
  | CheckoutDiffComparison
  | LiveDiffComparison
  | TurnDiffComparison
  | CommitRangeComparison;

/** From the oldest through the newest commit of the range, both included. */
export interface CommitRange {
  fromSha: string;
  toSha: string;
}

export function isTurnDiffComparison(
  comparison: WorkingDiffComparison,
): comparison is TurnDiffComparison {
  return comparison === "last_turn";
}

/** Comparisons of fixed git objects; they don't follow the dirty state or the live checkout. */
export function isSnapshotDiffComparison(
  comparison: WorkingDiffComparison,
): comparison is TurnDiffComparison | CommitRangeComparison {
  return comparison === "last_turn" || comparison === "commit_range";
}

export interface WorkingDiffComparisonOverride {
  serverId: string;
  cwd: string;
  comparison: WorkingDiffComparison;
  commitRange?: CommitRange;
  isDirtyAtSelection: boolean;
}

export interface WorkingDiffComparisonState {
  overrides: Record<string, WorkingDiffComparisonOverride>;
}

export interface WorkingDiffCheckoutIdentity {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
}

function normalizeCwd(cwd: string): string {
  const trimmed = cwd.trim();
  return trimmed === "/" ? trimmed : trimmed.replace(/\/+$/, "");
}

export function workingDiffComparisonKey(input: WorkingDiffCheckoutIdentity): string {
  const workspaceId = input.workspaceId?.trim();
  const checkout = workspaceId
    ? `workspace=${encodeURIComponent(workspaceId)}`
    : `cwd=${encodeURIComponent(normalizeCwd(input.cwd))}`;
  return `working-diff:server=${encodeURIComponent(input.serverId.trim())}:${checkout}`;
}

export function selectWorkingDiffComparisonInState(
  state: WorkingDiffComparisonState,
  input: WorkingDiffCheckoutIdentity & {
    comparison: WorkingDiffComparison;
    commitRange?: CommitRange;
    isDirty: boolean;
  },
): WorkingDiffComparisonState {
  return {
    overrides: {
      ...state.overrides,
      [workingDiffComparisonKey(input)]: {
        serverId: input.serverId.trim(),
        cwd: normalizeCwd(input.cwd),
        comparison: input.comparison,
        commitRange: input.commitRange,
        isDirtyAtSelection: input.isDirty,
      },
    },
  };
}

export function resolveWorkingDiffComparisonFromState(
  state: WorkingDiffComparisonState,
  input: WorkingDiffCheckoutIdentity & { isDirty: boolean },
): WorkingDiffComparison {
  const override = state.overrides[workingDiffComparisonKey(input)];
  // Status can render before boundary expiry runs, so resolution must also mask a stale
  // selection under any ordering of the two updates.
  if (
    override &&
    (isSnapshotDiffComparison(override.comparison) ||
      override.comparison === LiveDiffComparison.All ||
      override.isDirtyAtSelection === input.isDirty)
  ) {
    return override.comparison;
  }
  return input.isDirty ? "uncommitted" : "base";
}

export function resolveCommitRangeFromState(
  state: WorkingDiffComparisonState,
  input: WorkingDiffCheckoutIdentity,
): CommitRange | undefined {
  const override = state.overrides[workingDiffComparisonKey(input)];
  return override?.comparison === "commit_range" ? override.commitRange : undefined;
}

export function expireWorkingDiffComparisonsInState(
  state: WorkingDiffComparisonState,
  input: { serverId: string; cwd: string; isDirty: boolean },
): WorkingDiffComparisonState {
  // Expire at the status boundary so selections cannot return after an unmounted surface
  // misses a dirty-state transition.
  const staleKeys = Object.entries(state.overrides)
    .filter(
      ([, override]) =>
        override.serverId === input.serverId.trim() &&
        override.cwd === normalizeCwd(input.cwd) &&
        !isSnapshotDiffComparison(override.comparison) &&
        override.comparison !== LiveDiffComparison.All &&
        override.isDirtyAtSelection !== input.isDirty,
    )
    .map(([key]) => key);
  if (staleKeys.length === 0) return state;

  const overrides = { ...state.overrides };
  for (const key of staleKeys) delete overrides[key];
  return { overrides };
}
