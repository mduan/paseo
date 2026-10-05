import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { AgentUsage } from "@getpaseo/protocol/agent-types";
import { useShallow } from "zustand/react/shallow";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import {
  renderSidebarKebabTriggerIcon,
  sidebarKebabTriggerStyle,
} from "@/components/sidebar/sidebar-workspace-menu";
import { useOpenKebabMenuVisibility } from "@/components/sidebar/use-open-kebab-menu-visibility";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import { useWorkspaceTabMenuItemAdornments } from "@/screens/workspace/workspace-tab-menu-item";
import { useWorkspaceTabMenuRegistry } from "@/stores/workspace-tab-menu-registry";
import { workspaceTerminalsPushRoute } from "@/data/push-router";
import { useReplicaQuery } from "@/data/query";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSettings } from "@/hooks/use-settings";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { formatSessionCost } from "@/components/agent-cost";
import { resolveAgentModelSelection } from "@/composer/agent-controls/utils";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
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
import { getAgentActivityAt } from "@/utils/workspace-agent-activity";
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

/** Runs before a nested row navigates; the mobile sidebar uses it to close itself. */
export const WorkspaceSessionPressContext = createContext<(() => void) | undefined>(undefined);

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
  const onSessionPress = useContext(WorkspaceSessionPressContext);
  const handlePress = useCallback(() => {
    onSessionPress?.();
    navigateToWorkspace({ serverId, workspaceId, target: row.target });
  }, [onSessionPress, row.target, serverId, workspaceId]);
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
  const [isHovered, setIsHovered] = useState(false);
  // Hover is tracked on a plain wrapping View (docs/hover.md): on the Pressable, entering the
  // nested kebab trigger fires hoverOut and swaps the kebab back to the activity age.
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const isCompact = useIsCompactFormFactor();
  const layoutKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId }) ?? "";
  // Only a mounted workspace screen can run the tab actions, so unvisited workspaces get no menu.
  const hasMenu = useWorkspaceTabMenuRegistry((state) =>
    Boolean(row.tabId && state.builders[layoutKey]),
  );
  const kebab = useOpenKebabMenuVisibility(hasMenu && (isHovered || isNative || isCompact));

  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <SessionRowHoverTarget
          row={row}
          serverId={serverId}
          presentation={presentation}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        >
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
                  <View style={selected ? undefined : styles.iconUnfocused}>
                    <WorkspaceTabIcon
                      presentation={presentation}
                      active={selected}
                      backdrop={resolveBackdrop({
                        hovered: Boolean(hovered),
                        pressed,
                        selected,
                      })}
                    />
                  </View>
                  <Text style={selected ? styles.labelSelected : styles.label} numberOfLines={1}>
                    {presentation.titleState === "loading"
                      ? t("workspace.tabs.loading")
                      : presentation.label}
                  </Text>
                  {kebab.showKebab && row.tabId ? (
                    <WorkspaceSessionKebab
                      {...kebab.menuProps}
                      layoutKey={layoutKey}
                      tabId={row.tabId}
                      label={presentation.label}
                    />
                  ) : null}
                  {!kebab.showKebab && row.target.kind === "agent" ? (
                    <AgentActivityAge serverId={serverId} agentId={row.target.agentId} />
                  ) : null}
                </View>
                {row.target.kind === "agent" ? (
                  <AgentPreview serverId={serverId} agentId={row.target.agentId} />
                ) : null}
              </>
            )}
          </Pressable>
        </SessionRowHoverTarget>
      )}
    </WorkspaceTabPresentationResolver>
  );
});

/**
 * Carries the row's hover View. The tooltip shows the full tab name
 * and, for agents, the last response the row truncates to one line.
 */
function SessionRowHoverTarget({
  row,
  serverId,
  presentation,
  onPointerEnter,
  onPointerLeave,
  children,
}: {
  row: WorkspaceSessionRow;
  serverId: string;
  presentation: WorkspaceTabPresentation;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  children: ReactElement;
}) {
  return (
    <View
      style={styles.hoverTarget}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side="right"
          align="start"
          offset={8}
          maxWidth={360}
          style={styles.tooltipCard}
        >
          {/* The icon sits inline in the title so a wrapping name continues under it. */}
          <Text style={styles.tooltipTitle}>
            <View style={styles.tooltipIconSlot}>
              <WorkspaceTabIcon presentation={presentation} active backdrop="surface1" />
            </View>
            {presentation.label}
          </Text>
          {row.target.kind === "agent" ? (
            <>
              <AgentTooltipMeta serverId={serverId} agentId={row.target.agentId} />
              <AgentPreview serverId={serverId} agentId={row.target.agentId} full />
            </>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

function WorkspaceSessionKebab({
  layoutKey,
  tabId,
  label,
  open,
  onOpenChange,
}: {
  layoutKey: string;
  tabId: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const builder = useWorkspaceTabMenuRegistry((state) => state.builders[layoutKey]);
  // Built on open so the entries reflect the pane's tabs at that moment.
  const entries = useMemo(() => (open ? (builder?.(tabId) ?? []) : []), [builder, open, tabId]);
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={sidebarKebabTriggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={label}
        testID={`sidebar-workspace-session-kebab-${tabId}`}
      >
        {renderSidebarKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={260} sheetTitle={label}>
        {entries.map((entry) =>
          entry.kind === "separator" ? (
            <DropdownMenuSeparator key={entry.key} />
          ) : (
            <WorkspaceSessionMenuItem key={entry.key} entry={entry} />
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceSessionMenuItem({
  entry,
}: {
  entry: Extract<WorkspaceTabMenuEntry, { kind: "item" }>;
}) {
  const { leading, trailing } = useWorkspaceTabMenuItemAdornments(entry);
  return (
    <DropdownMenuItem
      testID={entry.testID}
      disabled={entry.disabled}
      destructive={entry.destructive}
      onSelect={entry.onSelect}
      tooltip={entry.tooltip}
      leading={leading}
      trailing={trailing}
    >
      {entry.label}
    </DropdownMenuItem>
  );
}

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

function AgentPreview({
  serverId,
  agentId,
  full = false,
}: {
  serverId: string;
  agentId: string;
  /** The tooltip shows the whole preview instead of the row's single line. */
  full?: boolean;
}) {
  const preview = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.lastAssistantPreview,
  );
  if (!preview) return null;
  return full ? (
    // Persisted previews from before the 300-character cap still run longer.
    <Text style={styles.tooltipPreview} numberOfLines={6}>
      {preview}
    </Text>
  ) : (
    <Text style={styles.preview} numberOfLines={1}>
      {preview}
    </Text>
  );
}

/** Total session cost, prefixed "~" when Paseo priced the provider's token counts itself. */
function formatAgentCost(usage: AgentUsage | null | undefined): string | null {
  if (typeof usage?.totalCostUsd !== "number") return null;
  const total = formatSessionCost(usage.totalCostUsd);
  if (!total) return null;
  return usage.totalCostEstimated ? `~${total}` : total;
}

/** Model, effort, and session cost; each part is left out when the agent doesn't report it. */
function AgentTooltipMeta({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const agent = useSessionStore((state) => state.sessions[serverId]?.agents?.get(agentId));
  const { entries } = useProvidersSnapshot(serverId, { cwd: agent?.cwd });
  const models = entries?.find((entry) => entry.provider === agent?.provider)?.models ?? null;
  const selection = resolveAgentModelSelection({
    models: filterSelectableModels(models),
    runtimeModelId: agent?.runtimeInfo?.model,
    configuredModelId: agent?.model,
    runtimeThinkingOptionId: agent?.runtimeInfo?.thinkingOptionId,
    explicitThinkingOptionId: agent?.thinkingOptionId,
  });
  const parts = [
    selection.activeModelId ? selection.displayModel : null,
    selection.selectedThinkingId
      ? t("workspace.tabs.effort", { effort: selection.displayThinking })
      : null,
    formatAgentCost(agent?.lastUsage),
  ].filter(Boolean);
  return parts.length > 0 ? <Text style={styles.tooltipMeta}>{parts.join(" · ")}</Text> : null;
}

function AgentActivityAge({ serverId, agentId }: { serverId: string; agentId: string }) {
  const lastActivityTime = useSessionStore((state) => {
    const agent = state.sessions[serverId]?.agents?.get(agentId);
    return agent ? getAgentActivityAt(agent).getTime() : null;
  });
  const date = useMemo(
    () => (lastActivityTime === null ? null : new Date(lastActivityTime)),
    [lastActivityTime],
  );
  const label = useCompactTimeAgo(date);
  return label ? <Text style={styles.age}>{label}</Text> : null;
}

// Inner padding before the icon. With the list's 4px left gutter, the icon sits 4px right of the
// workspace status dot.
const SESSION_ROW_INSET = 8 + 1 - 4;

const TOOLTIP_TITLE_LINE_HEIGHT = 20;

const styles = StyleSheet.create((theme) => ({
  // The gutter leaves a strip of the hovered workspace group's background around each row.
  list: {
    // Tuck under the workspace row's bottom padding; the bottom gutter matches the side gutters.
    marginTop: -theme.spacing[1],
    paddingBottom: theme.spacing[1],
    paddingLeft: theme.spacing[1],
    paddingRight: theme.spacing[1],
  },
  listIndented: {
    // Tuck under the workspace row's bottom padding; the bottom gutter matches the side gutters.
    marginTop: -theme.spacing[1],
    paddingBottom: theme.spacing[1],
    paddingLeft: theme.spacing[1] + theme.spacing[2],
    paddingRight: theme.spacing[1],
  },
  row: {
    justifyContent: "center",
    minHeight: 28,
    paddingVertical: theme.spacing[1],
    paddingLeft: SESSION_ROW_INSET,
    paddingRight: theme.spacing[3] - theme.spacing[1],
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
  // Matches the workspace hover card's surface and padding.
  tooltipCard: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  tooltipIconSlot: {
    marginRight: theme.spacing[1],
    verticalAlign: "middle",
  },
  // Matches the workspace hover card's title.
  tooltipTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: TOOLTIP_TITLE_LINE_HEIGHT,
    fontWeight: theme.fontWeight.normal,
  },
  tooltipMeta: {
    marginTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  tooltipPreview: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  // The workspace group already paints surfaceSidebarHover while hovered.
  hoverTarget: {
    position: "relative",
  },
  iconUnfocused: {
    opacity: 0.5,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
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
