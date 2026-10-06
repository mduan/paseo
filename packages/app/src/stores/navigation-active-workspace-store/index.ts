import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import {
  createLastWorkspaceSelectionStore,
  LAST_WORKSPACE_SELECTION_STORAGE_KEY,
  type ActiveWorkspaceSelection,
  type LastWorkspaceSelectionStorage,
} from "@/stores/last-workspace-selection";
import {
  navigateToLastWorkspace as navigateToLastWorkspacePure,
  navigateToWorkspace as navigateToWorkspacePure,
  parseActiveWorkspaceSelection,
  type NavigateToWorkspaceDeps,
  type NavigateToWorkspaceInput,
} from "./navigation";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit } from "@/utils/host-route-browser";
import { navigateToHostWorkspaceRoute } from "@/navigation/workspace-route-navigation";

export type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
export type { NavigateToWorkspaceInput } from "./navigation";

const lastWorkspaceSelectionStorage: LastWorkspaceSelectionStorage = {
  read: () => AsyncStorage.getItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY),
  write: (value) => AsyncStorage.setItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY, value),
  clear: () => AsyncStorage.removeItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY),
};

const lastWorkspaceSelectionStore = createLastWorkspaceSelectionStore(
  lastWorkspaceSelectionStorage,
);

function navigateDeps(): NavigateToWorkspaceDeps {
  return {
    getSessionWorkspaces: (serverId) => useSessionStore.getState().sessions[serverId]?.workspaces,
    getSessionAgents: (serverId) =>
      useSessionStore.getState().sessions[serverId]?.agents.values() ?? [],
    isWorkspaceLayoutHydrated: () => useWorkspaceLayoutStore.persist.hasHydrated(),
    openTab: (input) => useWorkspaceLayoutStore.getState().openTab(input),
    rememberLastWorkspace: (selection) => lastWorkspaceSelectionStore.remember(selection),
    navigateToRoute: (route) => {
      navigateToHostWorkspaceRoute(route);
      stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit();
    },
  };
}

export function hydrateLastWorkspaceSelection(): Promise<void> {
  return lastWorkspaceSelectionStore.hydrate();
}

export function getLastWorkspaceSelection(): ActiveWorkspaceSelection | null {
  return lastWorkspaceSelectionStore.getSelection();
}

export function getIsLastWorkspaceSelectionHydrated(): boolean {
  return lastWorkspaceSelectionStore.isHydrated();
}

export function navigateToWorkspace(input: NavigateToWorkspaceInput): string {
  return navigateToWorkspacePure(input, navigateDeps());
}

export function navigateToLastWorkspace(): boolean {
  return navigateToLastWorkspacePure({
    ...navigateDeps(),
    getLastWorkspaceSelection: () => lastWorkspaceSelectionStore.getSelection(),
  });
}

export function useActiveWorkspaceSelection(): ActiveWorkspaceSelection | null {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    workspaceId?: string | string[];
  }>();
  const selection = parseActiveWorkspaceSelection({ pathname: usePathname(), params });
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  useEffect(() => {
    if (!serverId || !workspaceId) {
      return;
    }
    lastWorkspaceSelectionStore.remember({ serverId, workspaceId });
  }, [serverId, workspaceId]);
  return selection;
}

// The workspace the foreground route shows, or null on any other route. Unlike the last
// workspace selection, which survives a trip to /new or Settings, this one tracks where the
// user is right now.
let foregroundWorkspaceSelection: ActiveWorkspaceSelection | null = null;

export function getForegroundWorkspaceSelection(): ActiveWorkspaceSelection | null {
  return foregroundWorkspaceSelection;
}

/** Mount once in a component that stays mounted across every route. */
export function useTrackForegroundWorkspaceSelection(): void {
  const selection = parseActiveWorkspaceSelection({ pathname: usePathname(), params: {} });
  const serverId = selection?.serverId;
  const workspaceId = selection?.workspaceId;
  useEffect(() => {
    foregroundWorkspaceSelection = serverId && workspaceId ? { serverId, workspaceId } : null;
  }, [serverId, workspaceId]);
}

export function useLastWorkspaceSelection(): ActiveWorkspaceSelection | null {
  return useSyncExternalStore(
    lastWorkspaceSelectionStore.subscribe,
    getLastWorkspaceSelection,
    getLastWorkspaceSelection,
  );
}

export function useIsLastWorkspaceSelectionHydrated(): boolean {
  return useSyncExternalStore(
    lastWorkspaceSelectionStore.subscribe,
    getIsLastWorkspaceSelectionHydrated,
    getIsLastWorkspaceSelectionHydrated,
  );
}

void hydrateLastWorkspaceSelection();
