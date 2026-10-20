import type { ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import { projectDisplayNameFromProjectId } from "@/utils/project-display-name";

export interface WorkspaceStructureHostPlacement {
  serverId: string;
  projectId: string;
  iconWorkingDir: string;
  worktreeSupport: "supported" | "unsupported" | "unknown";
  customIconRevision?: string | null;
  iconRevision?: string;
}

export interface WorkspaceStructureProject {
  viewKey: string;
  projectKey: string | null;
  projectName: string;
  projectKind: WorkspaceDescriptor["projectKind"] | "unknown";
  iconWorkingDir: string;
  hosts: WorkspaceStructureHostPlacement[];
  workspaceKeys: string[];
}

export interface WorkspaceStructure {
  projects: WorkspaceStructureProject[];
}

interface WorkspaceStructureSession {
  serverId: string;
  projects: Iterable<ProjectDescriptor>;
  workspaces: Iterable<WorkspaceDescriptor>;
}

/**
 * The single app boundary that turns host-local projects into display projects.
 * Each host's project is its own display project, even when another host has a
 * checkout of the same repo; `projectKey` is kept only to match equivalent
 * projects when switching hosts.
 */
export function buildWorkspaceStructureProjects(input: {
  sessions: WorkspaceStructureSession[];
}): WorkspaceStructureProject[] {
  const byProject = new Map<string, WorkspaceStructureProject>();

  for (const session of input.sessions) {
    for (const project of session.projects) {
      const viewKey = createProjectViewKey({
        serverId: session.serverId,
        projectId: project.projectId,
      });
      byProject.set(viewKey, {
        viewKey,
        projectKey: project.projectKey ?? null,
        projectName:
          project.projectCustomName ??
          project.projectDisplayName ??
          projectDisplayNameFromProjectId(project.projectId),
        projectKind: project.projectKind,
        iconWorkingDir: project.projectRootPath,
        hosts: [
          {
            serverId: session.serverId,
            projectId: project.projectId,
            iconWorkingDir: project.projectRootPath,
            worktreeSupport: project.projectKind === "git" ? "supported" : "unsupported",
            customIconRevision: project.projectCustomIconRevision,
            iconRevision: project.projectIconRevision,
          },
        ],
        workspaceKeys: [],
      });
    }
  }

  const workspaces = input.sessions.flatMap((session) =>
    Array.from(session.workspaces, (workspace) => ({ serverId: session.serverId, workspace })),
  );
  workspaces.sort((left, right) => compareWorkspaces(left.workspace, right.workspace));
  for (const { serverId, workspace } of workspaces) {
    byProject
      .get(createProjectViewKey({ serverId, projectId: workspace.projectId }))
      ?.workspaceKeys.push(`${serverId}:${workspace.id}`);
  }

  return Array.from(byProject.values()).sort(
    (left, right) =>
      left.projectName.localeCompare(right.projectName, undefined, {
        numeric: true,
        sensitivity: "base",
      }) || left.viewKey.localeCompare(right.viewKey),
  );
}

export function createProjectViewKey(identity: { serverId: string; projectId: string }): string {
  return JSON.stringify([identity.serverId, identity.projectId]);
}

export function parseProjectViewKey(
  viewKey: string,
): { serverId: string; projectId: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(viewKey);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { serverId: parsed[0], projectId: parsed[1] };
    }
  } catch {
    // Not a view key this module created.
  }
  return undefined;
}

function compareWorkspaces(left: WorkspaceDescriptor, right: WorkspaceDescriptor): number {
  return (
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.id.localeCompare(right.id, undefined, { sensitivity: "base" })
  );
}
