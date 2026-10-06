import { beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  PendingWorkspaceCreationStatus,
  selectVisiblePendingWorkspaceCreations,
  usePendingWorkspaceCreationStore,
} from "./pending-workspace-creation-store";

const identity = { serverId: "server-1", workspaceId: "workspace-1" };

function addEntry(): void {
  usePendingWorkspaceCreationStore.getState().add({
    ...identity,
    projectId: "project-1",
    title: "calm-otter",
    promptPreview: "Fix the flaky test",
  });
}

function entries() {
  return Object.values(usePendingWorkspaceCreationStore.getState().entriesByKey);
}

function descriptor(id: string): WorkspaceDescriptor {
  return {
    id,
    projectId: "project-1",
    projectDisplayName: "Project 1",
    projectRootPath: "/repo",
    workspaceDirectory: `/repo/${id}`,
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

beforeEach(() => {
  usePendingWorkspaceCreationStore.setState({ entriesByKey: {} });
});

describe("pending workspace creation store", () => {
  it("adds a creating entry for the accepted workspace", () => {
    addEntry();

    expect(entries()).toEqual([
      {
        ...identity,
        projectId: "project-1",
        title: "calm-otter",
        promptPreview: "Fix the flaky test",
        startedAt: expect.any(Number),
        status: PendingWorkspaceCreationStatus.Creating,
      },
    ]);
  });

  it("marks a workspace-stage failure on the existing entry", () => {
    addEntry();

    usePendingWorkspaceCreationStore.getState().fail({ ...identity, error: "git failed" });

    expect(entries()).toEqual([
      expect.objectContaining({
        status: PendingWorkspaceCreationStatus.Failed,
        error: "git failed",
      }),
    ]);
  });

  it("does not recreate an entry that was dismissed before a late failure", () => {
    addEntry();
    usePendingWorkspaceCreationStore.getState().remove(identity);

    usePendingWorkspaceCreationStore.getState().fail({ ...identity, error: "git failed" });

    expect(entries()).toEqual([]);
  });

  it("removes only the dismissed entry", () => {
    addEntry();
    usePendingWorkspaceCreationStore.getState().add({
      serverId: "server-1",
      workspaceId: "workspace-2",
      projectId: "project-1",
      title: "other",
      promptPreview: "",
    });

    usePendingWorkspaceCreationStore.getState().remove(identity);

    expect(entries().map((entry) => entry.workspaceId)).toEqual(["workspace-2"]);
  });
});

describe("selectVisiblePendingWorkspaceCreations", () => {
  it("shows an entry until the session store has its workspace descriptor", () => {
    addEntry();
    const pending = entries();

    const withoutDescriptor = selectVisiblePendingWorkspaceCreations(
      { sessions: { "server-1": { workspaces: new Map() } } },
      pending,
    );
    const withDescriptor = selectVisiblePendingWorkspaceCreations(
      {
        sessions: {
          "server-1": { workspaces: new Map([["workspace-1", descriptor("workspace-1")]]) },
        },
      },
      pending,
    );

    expect(withoutDescriptor).toEqual(pending);
    expect(withDescriptor).toEqual([]);
  });

  it("keeps an entry visible while its host has no session yet", () => {
    addEntry();

    expect(selectVisiblePendingWorkspaceCreations({ sessions: {} }, entries())).toEqual(entries());
  });
});
