import { useCallback } from "react";
import { create } from "zustand";
import {
  expireWorkingDiffComparisonsInState,
  resolveCommitRangeFromState,
  resolveWorkingDiffComparisonFromState,
  selectWorkingDiffComparisonInState,
  type CommitRange,
  type WorkingDiffCheckoutIdentity,
  type WorkingDiffComparison,
  type WorkingDiffComparisonState,
} from "./state";

interface WorkingDiffComparisonStore extends WorkingDiffComparisonState {
  select: (
    input: WorkingDiffCheckoutIdentity & {
      comparison: WorkingDiffComparison;
      commitRange?: CommitRange;
      isDirty: boolean;
    },
  ) => void;
}

const useWorkingDiffComparisonStore = create<WorkingDiffComparisonStore>((set) => ({
  overrides: {},
  select: (input) => set((state) => selectWorkingDiffComparisonInState(state, input)),
}));

export function useWorkingDiffComparison(
  input: WorkingDiffCheckoutIdentity & { isDirty: boolean },
): {
  comparison: WorkingDiffComparison;
  commitRange: CommitRange | undefined;
  selectComparison: (comparison: WorkingDiffComparison, commitRange?: CommitRange) => void;
} {
  const { serverId, workspaceId, cwd, isDirty } = input;
  const comparison = useWorkingDiffComparisonStore((state) =>
    resolveWorkingDiffComparisonFromState(state, { serverId, workspaceId, cwd, isDirty }),
  );
  const commitRange = useWorkingDiffComparisonStore((state) =>
    resolveCommitRangeFromState(state, { serverId, workspaceId, cwd }),
  );
  const select = useWorkingDiffComparisonStore((state) => state.select);
  const selectComparison = useCallback(
    (next: WorkingDiffComparison, nextCommitRange?: CommitRange) =>
      select({
        serverId,
        workspaceId,
        cwd,
        isDirty,
        comparison: next,
        commitRange: nextCommitRange,
      }),
    [cwd, isDirty, select, serverId, workspaceId],
  );
  return { comparison, commitRange, selectComparison };
}

export function selectWorkingDiffComparison(
  input: WorkingDiffCheckoutIdentity & {
    comparison: WorkingDiffComparison;
    isDirty: boolean;
  },
): void {
  useWorkingDiffComparisonStore.getState().select(input);
}

export function resolveWorkingDiffComparison(
  input: WorkingDiffCheckoutIdentity & { isDirty: boolean },
): WorkingDiffComparison {
  return resolveWorkingDiffComparisonFromState(useWorkingDiffComparisonStore.getState(), input);
}

export function expireWorkingDiffComparisons(input: {
  serverId: string;
  cwd: string;
  isDirty: boolean;
}): void {
  useWorkingDiffComparisonStore.setState((state) =>
    expireWorkingDiffComparisonsInState(state, input),
  );
}

export function resetWorkingDiffComparisons(): void {
  useWorkingDiffComparisonStore.setState({ overrides: {} });
}
