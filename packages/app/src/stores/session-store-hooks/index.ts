import { useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import {
  composeWorkspaceStructure,
  createWorkspaceStructureProjectsSelector,
  createWorkspaceTimeOrderSelector,
  selectHasHydratedWorkspaces,
  selectHydratedWorkspaceServerIds,
  selectWorkspaceDirectoryServerIds,
  selectHasWorkspaces,
  selectProjectOrder,
  selectRecommendedProjectPaths,
  selectWorkspace,
  selectWorkspaceDirectory,
  selectWorkspaceExists,
  selectWorkspaceFields,
  selectWorkspaceKeys,
  selectWorkspaceOrderByScope,
  selectWorkspaceStatusesForBadges,
  workspaceEqualityFns,
  type WorkspaceStructure,
} from "./selectors";
import { useSessionStore, type WorkspaceDescriptor } from "../session-store";
import type { DesktopBadgeWorkspaceStatus } from "@/utils/desktop-badge-state";
import { parseProjectViewKey } from "@/projects/workspace-structure";

// These are the ONLY supported ways to read workspaces from the session store.
// Do not write raw `useSessionStore` selectors that return the workspaces Map, a session object,
// or the sessions dict — it breaks re-render isolation.

export type {
  DesktopBadgeWorkspaceStatus,
  WorkspaceStructure,
  WorkspaceStructureProject,
} from "./selectors";

export function useWorkspace(
  serverId: string | null,
  workspaceId: string | null,
): WorkspaceDescriptor | null {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspace(state, serverId, workspaceId),
    workspaceEqualityFns.identity,
  );
}

export function useWorkspaceFields<T>(
  serverId: string | null,
  workspaceId: string | null,
  project: (w: WorkspaceDescriptor) => T,
): T | null {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspaceFields(state, serverId, workspaceId, project),
    workspaceEqualityFns.deep,
  );
}

export function useWorkspaceExists(serverId: string | null, workspaceId: string | null): boolean {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspaceExists(state, serverId, workspaceId),
    workspaceEqualityFns.identity,
  );
}

export function useHasHydratedWorkspaces(serverId: string | null): boolean {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectHasHydratedWorkspaces(state, serverId),
    workspaceEqualityFns.identity,
  );
}

export function useHydratedWorkspaceServerIds(serverIds: string[]): string[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectHydratedWorkspaceServerIds(state, serverIds),
    workspaceEqualityFns.deep,
  );
}

export function useWorkspaceDirectoryServerIds(serverIds: string[]): string[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspaceDirectoryServerIds(state, serverIds),
    workspaceEqualityFns.deep,
  );
}

export function useWorkspaceDirectory(
  serverId: string | null,
  workspaceId: string | null,
): string | null {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspaceDirectory(state, serverId, workspaceId),
    workspaceEqualityFns.identity,
  );
}

export function useWorkspaceStructure(serverIds: string[]): WorkspaceStructure {
  const selectProjects = useMemo(
    () => createWorkspaceStructureProjectsSelector(serverIds),
    [serverIds],
  );
  const projects = useStoreWithEqualityFn(
    useSessionStore,
    selectProjects,
    workspaceEqualityFns.deep,
  );
  const projectOrder = useStoreWithEqualityFn(
    useSidebarOrderStore,
    (state) => selectProjectOrder(state),
    workspaceEqualityFns.deep,
  );
  const manualWorkspaceOrderByScope = useStoreWithEqualityFn(
    useSidebarOrderStore,
    (state) => selectWorkspaceOrderByScope(state),
    workspaceEqualityFns.deep,
  );
  const sortMode = useSidebarViewStore((state) => state.sortMode);
  const selectTimeOrders = useMemo(
    () => createWorkspaceTimeOrderSelector(serverIds, sortMode),
    [serverIds, sortMode],
  );
  const timeWorkspaceOrderByScope = useStoreWithEqualityFn(
    useSessionStore,
    selectTimeOrders,
    workspaceEqualityFns.deep,
  );

  return useMemo(
    () =>
      composeWorkspaceStructure({
        projects,
        projectOrder,
        // Overrides without writing the manual order, so Manual restores the saved arrangement.
        workspaceOrderByScope: { ...manualWorkspaceOrderByScope, ...timeWorkspaceOrderByScope },
      }),
    [manualWorkspaceOrderByScope, projectOrder, projects, timeWorkspaceOrderByScope],
  );
}

export function useWorkspaceKeys(serverId: string | null): string[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspaceKeys(state, serverId),
    workspaceEqualityFns.deep,
  );
}

export function useRecommendedProjectPaths(serverId: string | null): string[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectRecommendedProjectPaths(state, serverId),
    workspaceEqualityFns.deep,
  );
}

export function useHasWorkspaces(serverId: string | null): boolean {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectHasWorkspaces(state, serverId),
    workspaceEqualityFns.identity,
  );
}

/** The project's chosen icon color, undefined while it uses the derived one. */
export function useProjectIconColor(projectViewKey: string): string | undefined {
  return useSessionStore((state) => {
    const identity = parseProjectViewKey(projectViewKey);
    if (!identity) return undefined;
    return (
      state.sessions[identity.serverId]?.projects.get(identity.projectId)?.projectIconColor ??
      undefined
    );
  });
}

export function useWorkspaceStatusesForBadges(): DesktopBadgeWorkspaceStatus[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspaceStatusesForBadges(state),
    workspaceEqualityFns.deep,
  );
}
