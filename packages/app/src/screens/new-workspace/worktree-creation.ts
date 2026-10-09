import type { CreationSnapshot } from "@getpaseo/protocol/messages";
import { retainAttachmentForGarbageCollection } from "@/attachments/gc-retention";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import { usePendingWorkspaceCreationStore } from "@/stores/pending-workspace-creation-store";
import type { PrepareWorkspaceTabInput } from "@/utils/prepare-workspace-tab";
import { toErrorMessage } from "@/utils/error-messages";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface WorktreeCreationPorts {
  navigateToWorkspace: (input: {
    serverId: string;
    workspaceId: string;
    target?: WorkspaceTabTarget;
  }) => void;
  prepareWorkspaceTab: (input: PrepareWorkspaceTabInput) => void;
  getActiveWorkspaceSelection: () => ActiveWorkspaceSelection | null;
}

interface WorktreeCreationInput {
  serverId: string;
  projectId: string;
  title: string;
  promptPreview: string;
  /** Used when a failed snapshot carries no message. */
  fallbackError: string;
  isStillOnCreateScreen: () => boolean;
  /** Releases the consumed draft. Absent when the submission has no draft to release. */
  clearConsumedDraft?: () => void;
  imageAttachmentIds?: readonly string[];
  ports: WorktreeCreationPorts;
}

/** What the screen knows about the creation. The flow adds what only it knows. */
export type WorktreeCreationContext = Pick<
  WorktreeCreationInput,
  "projectId" | "title" | "fallbackError" | "ports"
>;

/** Only a worktree create on a host with `creationLifecycle` outlives the screen. */
export function resolveWorktreeCreationContext(
  input: {
    createsWorktree: boolean;
    supportsCreationLifecycle: boolean;
    projectId: string | null;
  } & Pick<WorktreeCreationContext, "title" | "fallbackError" | "ports">,
): WorktreeCreationContext | undefined {
  const { createsWorktree, supportsCreationLifecycle, projectId, ...rest } = input;
  if (!createsWorktree || !supportsCreationLifecycle || !projectId) return undefined;
  return { projectId, ...rest };
}

export interface WorktreeCreationTracker {
  /** Feed every creation snapshot. `accepted` adds the pending entry and leaves the New workspace screen. */
  observe: (snapshot: CreationSnapshot) => void;
  navigatedEarly: () => boolean;
  /**
   * The workspace exists. Always prepares the tab so the draft can consume its agent creation, and
   * moves the foreground there only when the user is still on that workspace. Returns whether it did.
   */
  openWorkspace: (input: { workspaceId: string; target: WorkspaceTabTarget }) => boolean;
  /** Releases the consumed draft once, whichever step reaches it first. */
  clearDraft: () => void;
  /** Settles the pending entry with the outcome of the create call. */
  track: <T>(operation: Promise<T>) => Promise<T>;
}

/**
 * Worktree creation on a host with `creationLifecycle` outlives the New workspace screen: the
 * `accepted` snapshot already names the workspace, so the user moves on to it while the worktree
 * is built. Everything else keeps today's flow.
 */
export function createWorktreeCreationTracker(
  input: WorktreeCreationInput,
): WorktreeCreationTracker {
  const { serverId, ports } = input;
  const store = usePendingWorkspaceCreationStore.getState();
  // The accepted event clears the source draft before the destination draft owns its images.
  const releaseImages = input.imageAttachmentIds?.map(retainAttachmentForGarbageCollection) ?? [];
  let workspaceId: string | undefined;
  let workspaceReady = false;
  let navigated = false;
  let draftCleared = false;

  function clearDraft(): void {
    if (draftCleared) return;
    draftCleared = true;
    input.clearConsumedDraft?.();
  }

  function observe(snapshot: CreationSnapshot): void {
    if (snapshot.workspace) {
      workspaceReady = true;
    }
    if (snapshot.phase === "accepted" && snapshot.workspaceId) {
      workspaceId = snapshot.workspaceId;
      store.add({
        serverId,
        workspaceId,
        projectId: input.projectId,
        title: input.title,
        promptPreview: input.promptPreview,
      });
      if (input.isStillOnCreateScreen()) {
        clearDraft();
        navigated = true;
        ports.navigateToWorkspace({ serverId, workspaceId });
      }
      return;
    }
    if (
      snapshot.phase === "failed" &&
      snapshot.failedStage === "workspace" &&
      snapshot.workspaceId
    ) {
      store.fail({
        serverId,
        workspaceId: snapshot.workspaceId,
        error: snapshot.error ?? input.fallbackError,
      });
    }
  }

  function openWorkspace(target: { workspaceId: string; target: WorkspaceTabTarget }): boolean {
    const selection = ports.getActiveWorkspaceSelection();
    const userIsOnWorkspace =
      selection?.serverId === serverId && selection.workspaceId === target.workspaceId;
    const request = { serverId, workspaceId: target.workspaceId, target: target.target };
    if (userIsOnWorkspace) {
      ports.navigateToWorkspace(request);
    } else {
      ports.prepareWorkspaceTab(request);
    }
    store.remove({ serverId, workspaceId: target.workspaceId });
    return userIsOnWorkspace;
  }

  async function track<T>(operation: Promise<T>): Promise<T> {
    try {
      const result = await operation;
      if (workspaceId) {
        store.remove({ serverId, workspaceId });
      }
      return result;
    } catch (error) {
      if (workspaceId) {
        // Past the workspace stage the draft tab owns the error. The workspace is in the session
        // store, so the entry would only resurface if that workspace were later removed.
        if (workspaceReady) {
          store.remove({ serverId, workspaceId });
        } else {
          store.fail({ serverId, workspaceId, error: toErrorMessage(error) });
        }
      }
      throw error;
    } finally {
      for (const release of releaseImages) release();
    }
  }

  return { observe, navigatedEarly: () => navigated, openWorkspace, clearDraft, track };
}
