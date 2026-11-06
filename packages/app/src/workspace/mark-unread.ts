import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { collectAllTabs, findPaneById } from "@/stores/workspace-layout-actions";
import { useSessionStore } from "@/stores/session-store";

export async function markWorkspaceUnread(serverId: string, workspaceId: string): Promise<void> {
  return markUnread({ serverId, workspaceId });
}

export async function markAgentUnread({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}): Promise<void> {
  const session = useSessionStore.getState().sessions[serverId];
  const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
  if (!agent?.workspaceId) {
    throw new Error(i18n.t("agentPanel.states.notFound"));
  }
  return markUnread({ serverId, workspaceId: agent.workspaceId, agentId });
}

async function markUnread({
  serverId,
  workspaceId,
  agentId,
}: {
  serverId: string;
  workspaceId: string;
  agentId?: string;
}): Promise<void> {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) {
    throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
  }

  const workspaceKey = `${serverId}:${workspaceId}`;
  const layout = useWorkspaceLayoutStore.getState();
  const workspaceLayout = layout.layoutByWorkspace[workspaceKey];
  const focusedPane =
    workspaceLayout && findPaneById(workspaceLayout.root, workspaceLayout.focusedPaneId);
  const focusedTab =
    workspaceLayout &&
    collectAllTabs(workspaceLayout.root).find((tab) => tab.tabId === focusedPane?.focusedTabId);
  const isMarkedAgentFocused =
    focusedTab?.target.kind === "agent" && focusedTab.target.agentId === agentId;
  const shouldUnfocus = workspaceLayout?.focusedPaneId && (!agentId || isMarkedAgentFocused);
  // End viewing before restoring attention. The next pane focus reads it normally;
  // leaving the workspace must not consume the mark the user just made.
  const focusToken = shouldUnfocus ? layout.unfocusPane(workspaceKey) : null;
  try {
    if (agentId) {
      await client.markAgentUnread(agentId);
    } else {
      await client.markWorkspaceUnread(workspaceId);
    }
  } catch (error) {
    if (focusToken) {
      layout.restorePaneFocus(workspaceKey, focusToken);
    }
    throw error;
  }
}
