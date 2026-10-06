import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { PendingWorkspaceCreation } from "@/stores/pending-workspace-creation-store";

/** Groups pending creations under the project that owns them on their host, keyed by `viewKey`. */
export function groupPendingCreationsByProject(input: {
  projects: readonly Pick<SidebarProjectEntry, "viewKey" | "hosts">[];
  entries: readonly PendingWorkspaceCreation[];
}): Map<string, PendingWorkspaceCreation[]> {
  const grouped = new Map<string, PendingWorkspaceCreation[]>();
  for (const entry of input.entries) {
    const project = input.projects.find((candidate) =>
      candidate.hosts.some(
        (host) => host.serverId === entry.serverId && host.projectId === entry.projectId,
      ),
    );
    if (!project) continue;
    grouped.set(project.viewKey, [...(grouped.get(project.viewKey) ?? []), entry]);
  }
  return grouped;
}
