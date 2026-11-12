import equal from "fast-deep-equal";
import { hostSupportsFeature } from "@/runtime/host-features";
import {
  buildWorkspaceStructureProjects,
  createProjectViewKey,
  type WorkspaceStructure,
  type WorkspaceStructureProject,
} from "@/projects/workspace-structure";
import type { DesktopBadgeWorkspaceStatus } from "@/utils/desktop-badge-state";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { SidebarSortMode } from "@/stores/sidebar-view-store";
import type { DaemonServerInfo, ProjectDescriptor, WorkspaceDescriptor } from "../session-store";

export type { DesktopBadgeWorkspaceStatus } from "@/utils/desktop-badge-state";
export type { WorkspaceStructure, WorkspaceStructureProject } from "@/projects/workspace-structure";

export interface SessionsSnapshot {
  sessions: Record<
    string,
    {
      hasHydratedWorkspaces?: boolean;
      hasWorkspaceDirectorySnapshot?: boolean;
      workspaces: Map<string, WorkspaceDescriptor>;
      projects?: Map<string, ProjectDescriptor>;
      serverInfo?: DaemonServerInfo | null;
    }
  >;
}

export interface SidebarOrderSnapshot {
  projectOrder: string[];
  workspaceOrderByProject: Record<string, string[]>;
}

const EMPTY_WORKSPACE_KEYS: string[] = [];
const EMPTY_WORKSPACE_STRUCTURE: WorkspaceStructure = { projects: [] };

export const workspaceEqualityFns = {
  identity: Object.is as (a: unknown, b: unknown) => boolean,
  deep: equal as (a: unknown, b: unknown) => boolean,
};

function applyStoredOrdering<T>(input: {
  items: T[];
  storedOrder: readonly string[];
  getKey: (item: T) => string;
}): T[] {
  if (input.items.length <= 1 || input.storedOrder.length === 0) {
    return input.items;
  }

  const itemByKey = new Map<string, T>();
  for (const item of input.items) {
    itemByKey.set(input.getKey(item), item);
  }

  const prunedOrder: string[] = [];
  const seen = new Set<string>();
  for (const key of input.storedOrder) {
    if (!itemByKey.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    prunedOrder.push(key);
  }

  if (prunedOrder.length === 0) {
    return input.items;
  }

  const orderedSet = new Set(prunedOrder);
  const ordered: T[] = [];
  let orderedIndex = 0;

  for (const item of input.items) {
    const key = input.getKey(item);
    if (!orderedSet.has(key)) {
      ordered.push(item);
      continue;
    }

    const targetKey = prunedOrder[orderedIndex] ?? key;
    orderedIndex += 1;
    ordered.push(itemByKey.get(targetKey) ?? item);
  }

  return ordered;
}

export function selectWorkspace(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): WorkspaceDescriptor | null {
  if (!serverId || !workspaceId) {
    return null;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId,
  });
  return workspaceKey ? (workspaces?.get(workspaceKey) ?? null) : null;
}

export function selectWorkspaceFields<T>(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
  project: (w: WorkspaceDescriptor) => T,
): T | null {
  const workspace = selectWorkspace(state, serverId, workspaceId);
  return workspace ? project(workspace) : null;
}

export function selectWorkspaceDirectory(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): string | null {
  return selectWorkspace(state, serverId, workspaceId)?.workspaceDirectory || null;
}

export function selectWorkspaceExists(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): boolean {
  return selectWorkspace(state, serverId, workspaceId) !== null;
}

export function selectHasHydratedWorkspaces(
  state: SessionsSnapshot,
  serverId: string | null,
): boolean {
  return serverId ? (state.sessions[serverId]?.hasHydratedWorkspaces ?? false) : false;
}

export function selectHydratedWorkspaceServerIds(
  state: SessionsSnapshot,
  serverIds: readonly string[],
): string[] {
  return serverIds.filter((serverId) => state.sessions[serverId]?.hasHydratedWorkspaces === true);
}

export function selectWorkspaceDirectoryServerIds(
  state: SessionsSnapshot,
  serverIds: readonly string[],
): string[] {
  return serverIds.filter((serverId) => {
    const session = state.sessions[serverId];
    return (
      session?.hasHydratedWorkspaces === true || session?.hasWorkspaceDirectorySnapshot === true
    );
  });
}

export function selectWorkspaceStructureProjects(
  state: SessionsSnapshot,
  serverIds: readonly string[],
): WorkspaceStructureProject[] {
  const sessions: Array<{
    serverId: string;
    workspaces: Iterable<WorkspaceDescriptor>;
    projects: Iterable<ProjectDescriptor>;
  }> = [];

  for (const serverId of serverIds) {
    const session = state.sessions[serverId];
    const workspaces = session?.workspaces;
    const projects = session?.projects;
    if (!projects || projects.size === 0) {
      continue;
    }
    sessions.push({
      serverId,
      workspaces: workspaces?.values() ?? [],
      projects: projects.values(),
    });
  }

  if (sessions.length === 0) {
    return EMPTY_WORKSPACE_STRUCTURE.projects;
  }

  return buildWorkspaceStructureProjects({ sessions });
}

export function createWorkspaceStructureProjectsSelector(
  serverIds: readonly string[],
): (state: SessionsSnapshot) => WorkspaceStructureProject[] {
  let previousInputs: Array<{
    workspaces: Map<string, WorkspaceDescriptor> | undefined;
    projects: Map<string, ProjectDescriptor> | undefined;
  }> | null = null;
  let previousProjects: WorkspaceStructureProject[] | null = null;

  return (state) => {
    const inputs = serverIds.map((serverId) => ({
      workspaces: state.sessions[serverId]?.workspaces,
      projects: state.sessions[serverId]?.projects,
    }));
    const priorInputs = previousInputs;
    const unchanged =
      priorInputs !== null &&
      inputs.every(
        (input, index) =>
          input.workspaces === priorInputs[index]?.workspaces &&
          input.projects === priorInputs[index]?.projects,
      );
    if (unchanged && previousProjects) {
      return previousProjects;
    }

    previousInputs = inputs;
    previousProjects = selectWorkspaceStructureProjects(state, serverIds);
    return previousProjects;
  };
}

export function selectProject(
  state: SessionsSnapshot,
  serverId: string | null,
  projectId: string | null,
): ProjectDescriptor | null {
  if (!serverId || !projectId) return null;
  return state.sessions[serverId]?.projects?.get(projectId) ?? null;
}

export function selectProjectIdForServer(
  state: SessionsSnapshot,
  input: {
    sourceServerId: string;
    projectId: string;
    targetServerId: string;
  },
): string | null {
  if (input.sourceServerId === input.targetServerId) return input.projectId;
  const source = selectProject(state, input.sourceServerId, input.projectId);
  if (!source?.projectKey) return null;
  for (const project of state.sessions[input.targetServerId]?.projects?.values() ?? []) {
    if (project.projectKey === source.projectKey) return project.projectId;
  }
  return null;
}

const EMPTY_WORKSPACE_ORDER_BY_SCOPE: Record<string, string[]> = {};

/**
 * Timestamp-sort workspace order per project, newest first, shaped like the manual
 * `workspaceOrderByProject` it overrides. Hosts without `workspaceSortTimes` are omitted so they
 * keep the manual order. Recomputes only when a host's workspaces or server info change.
 */
export function createWorkspaceTimeOrderSelector(
  serverIds: readonly string[],
  sortMode: SidebarSortMode,
): (state: SessionsSnapshot) => Record<string, string[]> {
  let previousInputs: unknown[] | null = null;
  let previousOrders = EMPTY_WORKSPACE_ORDER_BY_SCOPE;

  return (state) => {
    if (sortMode === SidebarSortMode.Manual) return EMPTY_WORKSPACE_ORDER_BY_SCOPE;
    const inputs = serverIds.flatMap((serverId) => [
      state.sessions[serverId]?.workspaces,
      state.sessions[serverId]?.serverInfo,
    ]);
    if (previousInputs?.every((input, index) => input === inputs[index])) {
      return previousOrders;
    }
    previousInputs = inputs;
    previousOrders = selectWorkspaceTimeOrderByScope(state, serverIds, sortMode);
    return previousOrders;
  };
}

export function selectWorkspaceTimeOrderByScope(
  state: SessionsSnapshot,
  serverIds: readonly string[],
  sortMode: Exclude<SidebarSortMode, SidebarSortMode.Manual>,
): Record<string, string[]> {
  const entriesByScope: Record<string, Array<{ key: string; time: number }>> = {};
  for (const serverId of serverIds) {
    const session = state.sessions[serverId];
    if (!session || !hostSupportsFeature(session.serverInfo, "workspaceSortTimes")) continue;
    for (const workspace of session.workspaces.values()) {
      const timestamp = selectWorkspaceSortTime(workspace, sortMode);
      const scope = createProjectViewKey({ serverId, projectId: workspace.projectId });
      (entriesByScope[scope] ??= []).push({
        key: `${serverId}:${workspace.id}`,
        time: timestamp ? Date.parse(timestamp) : Number.NEGATIVE_INFINITY,
      });
    }
  }
  const orders: Record<string, string[]> = {};
  for (const [scope, entries] of Object.entries(entriesByScope)) {
    entries.sort((left, right) => right.time - left.time || left.key.localeCompare(right.key));
    orders[scope] = entries.map((entry) => entry.key);
  }
  return orders;
}

/** Never-prompted or never-answered workspaces fall back to their creation time. */
function selectWorkspaceSortTime(
  workspace: WorkspaceDescriptor,
  sortMode: Exclude<SidebarSortMode, SidebarSortMode.Manual>,
): string | undefined {
  switch (sortMode) {
    case SidebarSortMode.Created:
      return workspace.createdAt;
    case SidebarSortMode.LastPrompt:
      return workspace.lastHumanPromptAt ?? workspace.createdAt;
    case SidebarSortMode.LastResponse:
      return workspace.lastAgentResponseAt ?? workspace.createdAt;
  }
}

export function selectProjectOrder(state: SidebarOrderSnapshot): string[] {
  return state.projectOrder ?? EMPTY_WORKSPACE_KEYS;
}

export function selectWorkspaceOrderByScope(state: SidebarOrderSnapshot): Record<string, string[]> {
  return state.workspaceOrderByProject ?? {};
}

export function composeWorkspaceStructure(input: {
  projects: WorkspaceStructureProject[];
  projectOrder: readonly string[];
  workspaceOrderByScope: Record<string, readonly string[]>;
}): WorkspaceStructure {
  if (input.projects.length === 0) {
    return EMPTY_WORKSPACE_STRUCTURE;
  }

  const orderedProjects = applyStoredOrdering({
    items: input.projects.map((project) => {
      const workspaceOrder = input.workspaceOrderByScope[project.viewKey] ?? EMPTY_WORKSPACE_KEYS;
      return {
        ...project,
        workspaceKeys: applyStoredOrdering({
          items: project.workspaceKeys,
          storedOrder: workspaceOrder,
          getKey: (workspaceKey) => workspaceKey,
        }),
      };
    }),
    storedOrder: input.projectOrder,
    getKey: (project) => project.viewKey,
  });

  return { projects: orderedProjects };
}

export function selectWorkspaceKeys(state: SessionsSnapshot, serverId: string | null): string[] {
  if (!serverId) {
    return EMPTY_WORKSPACE_KEYS;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  return workspaces ? Array.from(workspaces.keys()) : EMPTY_WORKSPACE_KEYS;
}

export function selectRecommendedProjectPaths(
  state: SessionsSnapshot,
  serverId: string | null,
): string[] {
  if (!serverId) {
    return EMPTY_WORKSPACE_KEYS;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  if (!workspaces) {
    return EMPTY_WORKSPACE_KEYS;
  }
  return Array.from(workspaces.values())
    .map((workspace) => workspace.projectRootPath)
    .filter((path) => path.length > 0);
}

export function selectHasWorkspaces(state: SessionsSnapshot, serverId: string | null): boolean {
  if (!serverId) {
    return false;
  }
  return (state.sessions[serverId]?.workspaces?.size ?? 0) > 0;
}

export function selectWorkspaceStatusesForBadges(
  state: SessionsSnapshot,
): DesktopBadgeWorkspaceStatus[] {
  const statuses: DesktopBadgeWorkspaceStatus[] = [];
  for (const session of Object.values(state.sessions)) {
    for (const workspace of session.workspaces.values()) {
      statuses.push(workspace.status);
    }
  }
  return statuses;
}
