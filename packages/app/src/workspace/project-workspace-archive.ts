import { confirmRiskyWorktreeArchive, toWorktreeArchiveRisk } from "@/git/worktree-archive-warning";
import {
  createSidebarWorkspaceEntry,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceArchiveTarget } from "@/workspace/workspace-archive";

export interface ProjectWorkspaceArchiveEntry extends Pick<
  SidebarWorkspaceEntry,
  | "serverId"
  | "workspaceId"
  | "workspaceKind"
  | "name"
  | "archiveHasUncommittedChanges"
  | "archiveUnpushedCommitCount"
  | "diffStat"
> {}

export function getProjectWorkspaceArchiveEntries(input: {
  hosts: readonly Pick<SidebarProjectEntry["hosts"][number], "serverId" | "projectId">[];
  sessions: Record<string, { workspaces: ReadonlyMap<string, WorkspaceDescriptor> } | undefined>;
}): ProjectWorkspaceArchiveEntry[] {
  return input.hosts.flatMap(({ serverId, projectId }) =>
    Array.from(input.sessions[serverId]?.workspaces.values() ?? [])
      .filter((workspace) => workspace.projectId === projectId && !workspace.archivingAt)
      .map((workspace) => createSidebarWorkspaceEntry({ serverId, workspace })),
  );
}

type ConfirmWorktreeArchive = typeof confirmRiskyWorktreeArchive;

export async function selectProjectWorkspacesToArchive(
  workspaces: ProjectWorkspaceArchiveEntry[],
  confirmWorktreeArchive: ConfirmWorktreeArchive = confirmRiskyWorktreeArchive,
): Promise<WorkspaceArchiveTarget[]> {
  const confirmed: WorkspaceArchiveTarget[] = [];

  for (const workspace of workspaces) {
    if (workspace.workspaceKind === "worktree") {
      const shouldArchive = await confirmWorktreeArchive({
        workspaceName: workspace.name,
        ...toWorktreeArchiveRisk(workspace),
      });
      if (!shouldArchive) {
        continue;
      }
    }

    confirmed.push({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
    });
  }

  return confirmed;
}
