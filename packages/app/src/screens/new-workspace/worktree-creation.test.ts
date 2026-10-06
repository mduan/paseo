import type { CreationSnapshot } from "@getpaseo/protocol/messages";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import {
  PendingWorkspaceCreationStatus,
  usePendingWorkspaceCreationStore,
} from "@/stores/pending-workspace-creation-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  createWorktreeCreationTracker,
  resolveWorktreeCreationContext,
  type WorktreeCreationPorts,
} from "./worktree-creation";

const SERVER_ID = "server-1";
const WORKSPACE_ID = "workspace-1";
const DRAFT_TARGET: WorkspaceTabTarget = { kind: "draft", draftId: "draft-1" };

type PortCall =
  | { port: "navigate"; serverId: string; workspaceId: string; target?: WorkspaceTabTarget }
  | { port: "prepare"; serverId: string; workspaceId: string; target: WorkspaceTabTarget };

function createPorts(input: { activeSelection: ActiveWorkspaceSelection | null }) {
  const calls: PortCall[] = [];
  const ports: WorktreeCreationPorts = {
    navigateToWorkspace: (request) => calls.push({ port: "navigate", ...request }),
    prepareWorkspaceTab: (request) => calls.push({ port: "prepare", ...request }),
    getActiveWorkspaceSelection: () => input.activeSelection,
  };
  return { calls, ports };
}

const WORKSPACE_PAYLOAD: NonNullable<CreationSnapshot["workspace"]> = {
  id: WORKSPACE_ID,
  projectId: "project-1",
  projectDisplayName: "Project 1",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo/.paseo/worktrees/calm-otter",
  projectKind: "git",
  workspaceKind: "worktree",
  name: "calm-otter",
  archivingAt: null,
  status: "done",
  statusEnteredAt: null,
  activityAt: null,
  scripts: [],
  gitRuntime: null,
  githubRuntime: null,
};

function snapshot(patch: Partial<CreationSnapshot>): CreationSnapshot {
  return {
    kind: "workspace",
    idempotencyKey: "key-1",
    revision: 1,
    phase: "accepted",
    workspaceId: WORKSPACE_ID,
    agentId: null,
    error: null,
    ...patch,
  };
}

function createTracker(input: {
  ports: WorktreeCreationPorts;
  stillOnCreateScreen?: boolean;
  clearConsumedDraft?: () => void;
}) {
  return createWorktreeCreationTracker({
    serverId: SERVER_ID,
    projectId: "project-1",
    title: "calm-otter",
    promptPreview: "Fix the flaky test",
    fallbackError: "Failed to create worktree",
    isStillOnCreateScreen: () => input.stillOnCreateScreen ?? true,
    clearConsumedDraft: input.clearConsumedDraft,
    ports: input.ports,
  });
}

function entries() {
  return Object.values(usePendingWorkspaceCreationStore.getState().entriesByKey);
}

beforeEach(() => {
  usePendingWorkspaceCreationStore.setState({ entriesByKey: {} });
});

describe("worktree creation tracker", () => {
  it("adds the pending entry and leaves the New workspace screen when creation is accepted", () => {
    const { calls, ports } = createPorts({ activeSelection: null });
    let draftClears = 0;
    const tracker = createTracker({ ports, clearConsumedDraft: () => (draftClears += 1) });

    tracker.observe(snapshot({ phase: "accepted" }));

    expect(entries()).toEqual([
      {
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        projectId: "project-1",
        title: "calm-otter",
        promptPreview: "Fix the flaky test",
        startedAt: expect.any(Number),
        status: PendingWorkspaceCreationStatus.Creating,
      },
    ]);
    expect(calls).toEqual([{ port: "navigate", serverId: SERVER_ID, workspaceId: WORKSPACE_ID }]);
    expect(draftClears).toBe(1);
    expect(tracker.navigatedEarly()).toBe(true);
  });

  it("keeps the pending entry but does not navigate or clear the draft when the user already left", () => {
    const { calls, ports } = createPorts({ activeSelection: null });
    let draftClears = 0;
    const tracker = createTracker({
      ports,
      stillOnCreateScreen: false,
      clearConsumedDraft: () => (draftClears += 1),
    });

    tracker.observe(snapshot({ phase: "accepted" }));

    expect(entries()).toHaveLength(1);
    expect(calls).toEqual([]);
    expect(draftClears).toBe(0);
    expect(tracker.navigatedEarly()).toBe(false);
  });

  it("releases the consumed draft only once across accepted and the handoff", () => {
    const { ports } = createPorts({ activeSelection: null });
    let draftClears = 0;
    const tracker = createTracker({ ports, clearConsumedDraft: () => (draftClears += 1) });

    tracker.observe(snapshot({ phase: "accepted" }));
    tracker.clearDraft();
    tracker.clearDraft();

    expect(draftClears).toBe(1);
  });

  it("prepares the draft tab without switching routes when the user has left the workspace", () => {
    const { calls, ports } = createPorts({
      activeSelection: { serverId: SERVER_ID, workspaceId: "another-workspace" },
    });
    const tracker = createTracker({ ports });
    tracker.observe(snapshot({ phase: "accepted" }));
    calls.length = 0;

    const switched = tracker.openWorkspace({ workspaceId: WORKSPACE_ID, target: DRAFT_TARGET });

    expect(switched).toBe(false);
    expect(calls).toEqual([
      { port: "prepare", serverId: SERVER_ID, workspaceId: WORKSPACE_ID, target: DRAFT_TARGET },
    ]);
  });

  it("opens the draft tab through navigation when the user is still on the workspace", () => {
    const { calls, ports } = createPorts({
      activeSelection: { serverId: SERVER_ID, workspaceId: WORKSPACE_ID },
    });
    const tracker = createTracker({ ports });

    const switched = tracker.openWorkspace({ workspaceId: WORKSPACE_ID, target: DRAFT_TARGET });

    expect(switched).toBe(true);
    expect(calls).toEqual([
      { port: "navigate", serverId: SERVER_ID, workspaceId: WORKSPACE_ID, target: DRAFT_TARGET },
    ]);
  });

  it("marks the entry failed on a workspace-stage failure and ignores later stages", () => {
    const { ports } = createPorts({ activeSelection: null });
    const tracker = createTracker({ ports });
    tracker.observe(snapshot({ phase: "accepted" }));

    tracker.observe(snapshot({ phase: "failed", failedStage: "agent", error: "agent failed" }));
    expect(entries()[0]?.status).toBe(PendingWorkspaceCreationStatus.Creating);

    tracker.observe(snapshot({ phase: "failed", failedStage: "workspace", error: "git failed" }));
    expect(entries()).toEqual([
      expect.objectContaining({
        status: PendingWorkspaceCreationStatus.Failed,
        error: "git failed",
      }),
    ]);
  });

  it("falls back to the supplied message when a failed snapshot has none", () => {
    const { ports } = createPorts({ activeSelection: null });
    const tracker = createTracker({ ports });
    tracker.observe(snapshot({ phase: "accepted" }));

    tracker.observe(snapshot({ phase: "failed", failedStage: "workspace", error: null }));

    expect(entries()[0]?.error).toBe("Failed to create worktree");
  });

  it("removes the entry when the create call settles successfully", async () => {
    const { ports } = createPorts({ activeSelection: null });
    const tracker = createTracker({ ports });
    tracker.observe(snapshot({ phase: "accepted" }));

    await expect(tracker.track(Promise.resolve("done"))).resolves.toBe("done");

    expect(entries()).toEqual([]);
  });

  it("fails the entry when the create call rejects before the workspace exists", async () => {
    const { ports } = createPorts({ activeSelection: null });
    const tracker = createTracker({ ports });
    tracker.observe(snapshot({ phase: "accepted" }));

    await expect(tracker.track(Promise.reject(new Error("git failed")))).rejects.toThrow(
      "git failed",
    );

    expect(entries()).toEqual([
      expect.objectContaining({
        status: PendingWorkspaceCreationStatus.Failed,
        error: "git failed",
      }),
    ]);
  });

  it("drops the entry when the create call rejects after the workspace exists", async () => {
    const { ports } = createPorts({ activeSelection: null });
    const tracker = createTracker({ ports });
    tracker.observe(snapshot({ phase: "accepted" }));
    tracker.observe(
      snapshot({ phase: "workspace_ready", revision: 2, workspace: WORKSPACE_PAYLOAD }),
    );

    await expect(tracker.track(Promise.reject(new Error("agent failed")))).rejects.toThrow(
      "agent failed",
    );

    expect(entries()).toEqual([]);
  });

  it("does not recreate an entry dismissed before a late failure", async () => {
    const { ports } = createPorts({ activeSelection: null });
    const tracker = createTracker({ ports });
    tracker.observe(snapshot({ phase: "accepted" }));
    usePendingWorkspaceCreationStore
      .getState()
      .remove({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID });

    tracker.observe(snapshot({ phase: "failed", failedStage: "workspace", error: "git failed" }));
    await expect(tracker.track(Promise.reject(new Error("git failed")))).rejects.toThrow();

    expect(entries()).toEqual([]);
  });
});

describe("resolveWorktreeCreationContext", () => {
  const { ports } = createPorts({ activeSelection: null });
  const base = {
    createsWorktree: true,
    supportsCreationLifecycle: true,
    projectId: "project-1",
    title: "calm-otter",
    fallbackError: "Failed to create worktree",
    ports,
  };

  it("enables the flow for a worktree on a host with creation lifecycle", () => {
    expect(resolveWorktreeCreationContext(base)).toEqual({
      projectId: "project-1",
      title: "calm-otter",
      fallbackError: "Failed to create worktree",
      ports,
    });
  });

  it("keeps today's flow for a legacy host", () => {
    expect(
      resolveWorktreeCreationContext({ ...base, supportsCreationLifecycle: false }),
    ).toBeUndefined();
  });

  it("keeps today's flow for a local checkout", () => {
    expect(resolveWorktreeCreationContext({ ...base, createsWorktree: false })).toBeUndefined();
  });

  it("keeps today's flow when the project has no id on the host", () => {
    expect(resolveWorktreeCreationContext({ ...base, projectId: null })).toBeUndefined();
  });
});
