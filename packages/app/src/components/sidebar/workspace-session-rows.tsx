import { memo, useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { workspaceTerminalsPushRoute } from "@/data/push-router";
import { useReplicaQuery } from "@/data/query";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSettings } from "@/hooks/use-settings";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
} from "@/screens/workspace/workspace-tab-presentation";
import {
  buildTerminalsQueryKey,
  collectScriptTerminalIds,
  collectStandaloneTerminalIds,
  type ListTerminalsPayload,
} from "@/screens/workspace/terminals/state";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { collectAllTabs, findPaneById } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTab } from "@/workspace-tabs/model";
import {
  orderWorkspaceSessions,
  type WorkspaceSessionRow,
} from "@/components/sidebar/workspace-session-order";

export interface WorkspaceSessionRows {
  rows: WorkspaceSessionRow[];
  /** Absent when every session kind is switched off, so the row reserves no chevron slot. */
  expandToggle: { expanded: boolean; visible: boolean; onToggle: () => void } | null;
  focusedTabId: string | null;
  /** The focused tab is one of the visible nested rows, so it carries the highlight. */
  showsFocusedRow: boolean;
}

const EMPTY_TABS: WorkspaceTab[] = [];
const EMPTY_IDS: string[] = [];

export function useWorkspaceSessionRows(workspace: SidebarWorkspaceEntry): WorkspaceSessionRows {
  const { serverId, workspaceId, workspaceDirectory } = workspace;
  const kinds = useSettings(
    useShallow((settings) => ({
      agents: settings.sidebarAgentRows,
      terminals: settings.sidebarTerminalRows,
      browsers: settings.sidebarBrowserRows,
    })),
  );
  const enabled = kinds.agents || kinds.terminals || kinds.browsers;
  const layoutKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId }) ?? "";
  const expanded = useSidebarCollapsedSectionsStore(
    (state) => !state.collapsedWorkspaceKeys.has(layoutKey),
  );
  const toggleWorkspaceCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleWorkspaceCollapsed,
  );

  // Each workspace reads only its own slice of the layout, so focusing a tab elsewhere does not
  // re-render every row in the sidebar.
  const tabs = useWorkspaceLayoutStore(
    useShallow((state) => {
      const layout = enabled ? state.layoutByWorkspace[layoutKey] : undefined;
      return layout ? collectAllTabs(layout.root) : EMPTY_TABS;
    }),
  );
  const focusedTabId = useWorkspaceLayoutStore((state) => {
    const layout = enabled ? state.layoutByWorkspace[layoutKey] : undefined;
    return layout ? (findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId ?? null) : null;
  });
  const hiddenAgentIds = useWorkspaceLayoutStore(
    (state) => state.hiddenAgentIdsByWorkspace[layoutKey],
  );

  const agentIds = useSessionStore(
    useShallow((state) => {
      if (!kinds.agents) return EMPTY_IDS;
      const session = state.sessions[serverId];
      const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(workspaceId);
      if (!session?.agents || !normalizedWorkspaceId) return EMPTY_IDS;
      const agents = Array.from(session.agents.values()).filter((agent) => {
        if (agent.archivedAt) return false;
        if (normalizeWorkspaceOpaqueId(agent.workspaceId) !== normalizedWorkspaceId) return false;
        // `/clear` and friends hide the agent they replace; it stays unarchived but has no tab.
        if (hiddenAgentIds?.has(agent.id)) return false;
        const parent = agent.parentAgentId
          ? (session.agents.get(agent.parentAgentId) ??
            session.agentDetails?.get(agent.parentAgentId))
          : undefined;
        return isWorkspaceRootAgent(agent, parent);
      });
      agents.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return agents.map((agent) => agent.id);
    }),
  );

  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const terminalsEnabled = Boolean(kinds.terminals && expanded && client && workspaceDirectory);
  // Same key and push route as the workspace screen, so an open workspace shares one subscription.
  const terminalsQuery = useReplicaQuery({
    queryKey: buildTerminalsQueryKey(serverId, workspaceDirectory, workspaceId || null),
    enabled: terminalsEnabled,
    pushEvent: "terminals_changed",
    meta: workspaceTerminalsPushRoute({
      enabled: terminalsEnabled,
      serverId,
      cwd: workspaceDirectory,
      ...(workspaceId ? { workspaceId } : {}),
    }),
    queryFn: async (): Promise<ListTerminalsPayload> => {
      if (!client) throw new Error("Host disconnected");
      return client.listTerminals(
        workspaceDirectory,
        undefined,
        workspaceId ? { workspaceId } : {},
      );
    },
  });
  const terminals = terminalsQuery.data?.terminals;
  const terminalIds = useMemo(() => {
    if (!terminals) return EMPTY_IDS;
    return collectStandaloneTerminalIds({
      terminals,
      scriptTerminalIds: collectScriptTerminalIds({
        pendingScriptTerminalIds: new Map(),
        scripts: workspace.scripts,
      }),
    });
  }, [terminals, workspace.scripts]);

  const rows = useMemo(
    () => orderWorkspaceSessions({ tabs, agentIds, terminalIds, kinds }),
    [tabs, agentIds, terminalIds, kinds],
  );
  const onToggle = useCallback(
    () => toggleWorkspaceCollapsed(layoutKey),
    [layoutKey, toggleWorkspaceCollapsed],
  );
  const expandToggle = useMemo(
    () =>
      enabled
        ? {
            expanded,
            // Collapsed rows keep the chevron: terminals are only listed while expanded.
            visible: rows.length > 0 || !expanded,
            onToggle,
          }
        : null,
    [enabled, expanded, rows.length, onToggle],
  );
  const showsFocusedRow =
    expanded && focusedTabId !== null && rows.some((row) => row.tabId === focusedTabId);

  return {
    rows: expanded ? rows : [],
    expandToggle,
    focusedTabId,
    showsFocusedRow,
  };
}

export const WorkspaceSessionRowList = memo(function WorkspaceSessionRowList({
  workspace,
  sessions,
  workspaceSelected,
  indented = false,
}: {
  workspace: SidebarWorkspaceEntry;
  sessions: WorkspaceSessionRows;
  workspaceSelected: boolean;
  /** Matches the extra indent status-group rows carry. */
  indented?: boolean;
}) {
  if (sessions.rows.length === 0) return null;
  return (
    <View
      style={indented ? styles.listIndented : styles.list}
      testID={`sidebar-workspace-sessions-${workspace.workspaceKey}`}
    >
      {sessions.rows.map((row) => (
        <WorkspaceSessionRowItem
          key={row.key}
          row={row}
          serverId={workspace.serverId}
          workspaceId={workspace.workspaceId}
          selected={workspaceSelected && row.tabId !== null && row.tabId === sessions.focusedTabId}
        />
      ))}
    </View>
  );
});

const WorkspaceSessionRowItem = memo(function WorkspaceSessionRowItem({
  row,
  serverId,
  workspaceId,
  selected,
}: {
  row: WorkspaceSessionRow;
  serverId: string;
  workspaceId: string;
  selected: boolean;
}) {
  const { t } = useTranslation();
  const tab = useMemo(
    () => ({
      key: row.key,
      tabId: row.tabId ?? row.key,
      kind: row.target.kind,
      target: row.target,
    }),
    [row],
  );
  const handlePress = useCallback(() => {
    navigateToWorkspace({ serverId, workspaceId, target: row.target });
  }, [row.target, serverId, workspaceId]);
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      selected && styles.rowSelected,
      pressed && styles.rowPressed,
    ],
    [selected],
  );

  const accessibilityState = useMemo(() => ({ selected }), [selected]);

  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <Pressable
          onPress={handlePress}
          style={pressableStyle}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          testID={`sidebar-workspace-session-${row.key}`}
        >
          {({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => (
            <>
              <View style={styles.titleLine}>
                <WorkspaceTabIcon
                  presentation={presentation}
                  active={selected}
                  backdrop={resolveBackdrop({ hovered: Boolean(hovered), pressed, selected })}
                />
                <Text style={selected ? styles.labelSelected : styles.label} numberOfLines={1}>
                  {presentation.titleState === "loading"
                    ? t("workspace.tabs.loading")
                    : presentation.label}
                </Text>
                {row.target.kind === "agent" ? (
                  <AgentActivityAge serverId={serverId} agentId={row.target.agentId} />
                ) : null}
              </View>
              {row.target.kind === "agent" ? (
                <AgentPreview serverId={serverId} agentId={row.target.agentId} />
              ) : null}
            </>
          )}
        </Pressable>
      )}
    </WorkspaceTabPresentationResolver>
  );
});

function resolveBackdrop(input: {
  hovered: boolean;
  pressed: boolean;
  selected: boolean;
}): SurfaceBackdrop {
  if (input.pressed) return "surface2";
  if (input.selected) return "surfaceSidebarSelected";
  if (input.hovered) return "surfaceSidebarHover";
  return "surfaceSidebar";
}

function AgentPreview({ serverId, agentId }: { serverId: string; agentId: string }) {
  const preview = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.lastAssistantPreview,
  );
  return preview ? (
    <Text style={styles.preview} numberOfLines={1}>
      {preview}
    </Text>
  ) : null;
}

function AgentActivityAge({ serverId, agentId }: { serverId: string; agentId: string }) {
  const lastActivityTime = useSessionStore((state) => {
    const lastActivityAt =
      state.agentLastActivity.get(agentId) ??
      state.sessions[serverId]?.agents?.get(agentId)?.lastActivityAt;
    return lastActivityAt ? lastActivityAt.getTime() : null;
  });
  const date = useMemo(
    () => (lastActivityTime === null ? null : new Date(lastActivityTime)),
    [lastActivityTime],
  );
  const label = useCompactTimeAgo(date);
  return label ? <Text style={styles.age}>{label}</Text> : null;
}

// The icon lines up under the workspace title: row padding, chevron, status slot and their gaps.
const SESSION_ROW_INSET = 8 + 12 + 8 + 16 + 8 - 4;

const styles = StyleSheet.create((theme) => ({
  list: {
    marginBottom: theme.spacing[0.5],
  },
  listIndented: {
    marginBottom: theme.spacing[0.5],
    paddingLeft: theme.spacing[2],
  },
  row: {
    justifyContent: "center",
    minHeight: 28,
    paddingVertical: theme.spacing[1],
    paddingLeft: SESSION_ROW_INSET,
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    userSelect: "none",
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // Starts under the title, past the 14px tab icon and its gap.
  preview: {
    paddingLeft: 14 + theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowSelected: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  label: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    opacity: 0.76,
  },
  labelSelected: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  age: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
