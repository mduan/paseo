import { create } from "zustand";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore } from "@/stores/session-store";
import {
  selectWorkspaceExists,
  type SessionsSnapshot,
} from "@/stores/session-store-hooks/selectors";

export enum PendingWorkspaceCreationStatus {
  Creating = "creating",
  Failed = "failed",
}

export interface PendingWorkspaceCreation {
  serverId: string;
  workspaceId: string;
  projectId: string;
  title: string;
  promptPreview: string;
  startedAt: number;
  status: PendingWorkspaceCreationStatus;
  error?: string;
}

type WorkspaceIdentity = Pick<PendingWorkspaceCreation, "serverId" | "workspaceId">;

type AddPendingWorkspaceCreationInput = WorkspaceIdentity &
  Pick<PendingWorkspaceCreation, "projectId" | "title" | "promptPreview">;

interface PendingWorkspaceCreationState {
  entriesByKey: Record<string, PendingWorkspaceCreation>;
  add: (input: AddPendingWorkspaceCreationInput) => void;
  /** Updates an entry that still exists. A late failure never recreates a dismissed one. */
  fail: (input: WorkspaceIdentity & { error: string }) => void;
  remove: (input: WorkspaceIdentity) => void;
}

function entryKey({ serverId, workspaceId }: WorkspaceIdentity): string {
  return JSON.stringify([serverId, workspaceId]);
}

/**
 * In-memory only: a reload mid-creation drops the entry, and the workspace still appears once
 * the server finishes. Visibility is derived from the session store by the hooks below, so
 * whichever path delivers the workspace hides the pending UI without this store listening.
 */
export const usePendingWorkspaceCreationStore = create<PendingWorkspaceCreationState>((set) => ({
  entriesByKey: {},
  add: (input) =>
    set((state) => ({
      entriesByKey: {
        ...state.entriesByKey,
        [entryKey(input)]: {
          ...input,
          startedAt: Date.now(),
          status: PendingWorkspaceCreationStatus.Creating,
        },
      },
    })),
  fail: ({ error, ...identity }) =>
    set((state) => {
      const key = entryKey(identity);
      const current = state.entriesByKey[key];
      if (!current) {
        return state;
      }
      return {
        entriesByKey: {
          ...state.entriesByKey,
          [key]: { ...current, status: PendingWorkspaceCreationStatus.Failed, error },
        },
      };
    }),
  remove: (identity) =>
    set((state) => {
      const key = entryKey(identity);
      if (!state.entriesByKey[key]) {
        return state;
      }
      const { [key]: _removed, ...rest } = state.entriesByKey;
      return { entriesByKey: rest };
    }),
}));

const NO_ENTRIES: PendingWorkspaceCreation[] = [];

/** Entries whose workspace the session store does not know yet. */
export function selectVisiblePendingWorkspaceCreations(
  sessions: SessionsSnapshot,
  entries: readonly PendingWorkspaceCreation[],
): PendingWorkspaceCreation[] {
  if (entries.length === 0) {
    return NO_ENTRIES;
  }
  return entries.filter(
    (entry) => !selectWorkspaceExists(sessions, entry.serverId, entry.workspaceId),
  );
}

export function useVisiblePendingWorkspaceCreations(): PendingWorkspaceCreation[] {
  const entriesByKey = usePendingWorkspaceCreationStore((state) => state.entriesByKey);
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectVisiblePendingWorkspaceCreations(state, Object.values(entriesByKey)),
    shallow,
  );
}

export function useVisiblePendingWorkspaceCreation(
  identity: WorkspaceIdentity,
): PendingWorkspaceCreation | undefined {
  const entry = usePendingWorkspaceCreationStore((state) => state.entriesByKey[entryKey(identity)]);
  const hasDescriptor = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspaceExists(state, identity.serverId, identity.workspaceId),
    Object.is,
  );
  return hasDescriptor ? undefined : entry;
}
