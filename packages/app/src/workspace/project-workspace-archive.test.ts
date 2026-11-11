import { describe, expect, it, vi } from "vitest";
import {
  getProjectWorkspaceArchiveEntries,
  selectProjectWorkspacesToArchive,
} from "@/workspace/project-workspace-archive";

import type { WorkspaceDescriptor } from "@/stores/session-store";

describe("selectProjectWorkspacesToArchive", () => {
  it("skips archiving a dirty and unpushed worktree when the risky archive confirmation is canceled", async () => {
    const confirmWorktreeArchive = vi.fn(async () => false);

    const targets = await selectProjectWorkspacesToArchive(
      [
        {
          serverId: "server-1",
          workspaceId: "workspace-worktree",
          workspaceKind: "worktree",
          name: "feature/risky",
          archiveHasUncommittedChanges: true,
          archiveUnpushedCommitCount: 2,
          diffStat: { additions: 5, deletions: 1 },
        },
        {
          serverId: "server-1",
          workspaceId: "workspace-checkout",
          workspaceKind: "local_checkout",
          name: "main",
          archiveHasUncommittedChanges: null,
          archiveUnpushedCommitCount: null,
          diffStat: null,
        },
      ],
      confirmWorktreeArchive,
    );

    expect(confirmWorktreeArchive).toHaveBeenCalledOnce();
    expect(confirmWorktreeArchive).toHaveBeenCalledWith({
      workspaceName: "feature/risky",
      isDirty: true,
      aheadOfOrigin: 2,
      diffStat: { additions: 5, deletions: 1 },
    });
    expect(targets).toEqual([
      {
        serverId: "server-1",
        workspaceId: "workspace-checkout",
      },
    ]);
  });

  it("includes a dirty and unpushed worktree when the risky archive confirmation is accepted", async () => {
    const confirmWorktreeArchive = vi.fn(async () => true);

    const targets = await selectProjectWorkspacesToArchive(
      [
        {
          serverId: "server-1",
          workspaceId: "workspace-worktree",
          workspaceKind: "worktree",
          name: "feature/risky",
          archiveHasUncommittedChanges: true,
          archiveUnpushedCommitCount: 2,
          diffStat: { additions: 5, deletions: 1 },
        },
        {
          serverId: "server-1",
          workspaceId: "workspace-checkout",
          workspaceKind: "local_checkout",
          name: "main",
          archiveHasUncommittedChanges: null,
          archiveUnpushedCommitCount: null,
          diffStat: null,
        },
      ],
      confirmWorktreeArchive,
    );

    expect(confirmWorktreeArchive).toHaveBeenCalledOnce();
    expect(confirmWorktreeArchive).toHaveBeenCalledWith({
      workspaceName: "feature/risky",
      isDirty: true,
      aheadOfOrigin: 2,
      diffStat: { additions: 5, deletions: 1 },
    });
    expect(targets).toEqual([
      {
        serverId: "server-1",
        workspaceId: "workspace-worktree",
      },
      {
        serverId: "server-1",
        workspaceId: "workspace-checkout",
      },
    ]);
  });
});

describe("getProjectWorkspaceArchiveEntries", () => {
  it("includes pinned workspaces and only selects the specified host project", () => {
    const workspace = (input: Partial<WorkspaceDescriptor>): WorkspaceDescriptor => ({
      id: "workspace-1",
      projectId: "project-1",
      projectDisplayName: "Project",
      projectRootPath: "/repo/project",
      workspaceDirectory: "/repo/project/workspace-1",
      projectKind: "git",
      workspaceKind: "worktree",
      name: "workspace-1",
      status: "done",
      archivingAt: null,
      statusEnteredAt: null,
      diffStat: null,
      scripts: [],
      ...input,
    });
    const workspaces = [
      workspace({ id: "pinned", pinnedAt: "2026-11-01T00:00:00Z" }),
      workspace({ id: "ordinary" }),
      workspace({ id: "other-project", projectId: "project-2" }),
      workspace({ id: "already-archiving", archivingAt: "2026-11-01T00:00:00Z" }),
    ];

    const entries = getProjectWorkspaceArchiveEntries({
      hosts: [{ serverId: "server-1", projectId: "project-1" }],
      sessions: {
        "server-1": { workspaces: new Map(workspaces.map((entry) => [entry.id, entry])) },
        "server-2": { workspaces: new Map([["workspace-1", workspace({})]]) },
      },
    });

    expect(entries.map(({ serverId, workspaceId }) => ({ serverId, workspaceId }))).toEqual([
      { serverId: "server-1", workspaceId: "pinned" },
      { serverId: "server-1", workspaceId: "ordinary" },
    ]);
  });
});
