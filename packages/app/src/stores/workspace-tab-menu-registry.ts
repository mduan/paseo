import { create } from "zustand";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

type PendingSelection = Pick<WorkspaceTabDescriptor, "tabId"> & {
  workspaceKey: string;
  entryKey: string;
};

export type WorkspaceTabMenuBuilder = (tabId: string) => WorkspaceTabMenuEntry[] | null;

/**
 * Tab actions need the workspace's dialogs and close policies. The sidebar can show its menu
 * before that screen mounts; selecting an action opens the workspace and waits for its builder.
 */
export const useWorkspaceTabMenuRegistry = create<{
  builders: Record<string, WorkspaceTabMenuBuilder>;
  pendingSelection?: PendingSelection;
}>(() => ({ builders: {} }));

export function selectWorkspaceTabMenuEntry({
  serverId,
  workspaceId,
  tab,
  entryKey,
}: {
  serverId: string;
  workspaceId: string;
  tab: WorkspaceTabDescriptor;
  entryKey: string;
}) {
  useWorkspaceTabMenuRegistry.setState({
    pendingSelection: { workspaceKey: `${serverId}:${workspaceId}`, tabId: tab.tabId, entryKey },
  });
  navigateToWorkspace({ serverId, workspaceId, target: tab.target });
}

export function registerWorkspaceTabMenuBuilder(key: string, builder: WorkspaceTabMenuBuilder) {
  useWorkspaceTabMenuRegistry.setState((state) => ({
    builders: { ...state.builders, [key]: builder },
  }));
  const pending = useWorkspaceTabMenuRegistry.getState().pendingSelection;
  if (pending?.workspaceKey === key) {
    const entry = builder(pending.tabId)?.find((item) => item.key === pending.entryKey);
    if (entry?.kind === "item") {
      useWorkspaceTabMenuRegistry.setState({ pendingSelection: undefined });
      entry.onSelect();
    }
  }
  return () => {
    useWorkspaceTabMenuRegistry.setState((state) => {
      if (state.builders[key] !== builder) return state;
      const { [key]: _removed, ...builders } = state.builders;
      return { builders };
    });
  };
}
