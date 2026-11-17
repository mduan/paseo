import {
  DraggableList,
  type DraggableListProps,
  type DraggableRenderItemInfo,
} from "@/components/draggable-list";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import { applyStoredOrdering } from "@/hooks/sidebar-workspaces-view-model";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { mergeWithRemainder } from "@/utils/sidebar-reorder";
import { useMarkAgentUnread } from "@/hooks/use-mark-agent-unread";
import { ConversationTitleTarget } from "@getpaseo/protocol/messages";
import { useAiRename } from "@/workspace/ai-rename/use-ai-rename";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContextMenuTrigger, useContextMenu } from "@/components/ui/context-menu";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import {
  renderSidebarKebabTriggerIcon,
  sidebarKebabTriggerStyle,
} from "@/components/sidebar/sidebar-workspace-menu";
import { useOpenKebabMenuVisibility } from "@/components/sidebar/use-open-kebab-menu-visibility";
import {
  buildWorkspaceTabMenuEntries,
  type WorkspaceTabMenuEntry,
} from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";
import { useWorkspaceTabMenuItemAdornments } from "@/screens/workspace/workspace-tab-menu-item";
import {
  selectWorkspaceTabMenuEntry,
  useWorkspaceTabMenuRegistry,
} from "@/stores/workspace-tab-menu-registry";
import { workspaceTerminalsPushRoute } from "@/data/push-router";
import { useReplicaQuery } from "@/data/query";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSettings } from "@/hooks/use-settings";
import { useAgentMetaParts } from "@/components/agent-meta";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
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
import {
  collectAllTabs,
  findPaneById,
  findPaneContainingTab,
} from "@/stores/workspace-layout-actions";
import {
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import { getAgentActivityAt } from "@/utils/workspace-agent-activity";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTab } from "@/workspace-tabs/model";
import {
  orderWorkspaceSessions,
  selectWorkspaceSessionAgentIds,
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

type WorkspaceSessionListContextValue = Pick<
  DraggableListProps<WorkspaceSessionRow>,
  "simultaneousGestureRef" | "gestureHostPresented"
> & { onPress?: () => void };

export const WorkspaceSessionListContext = createContext<WorkspaceSessionListContextValue>({});

const EMPTY_TABS: WorkspaceTab[] = [];
const EMPTY_IDS: string[] = [];

function sessionRowKey(row: WorkspaceSessionRow): string {
  return row.key;
}

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

  // Collapsed workspaces show no rows, and nothing else reads their agents.
  const agentIds = useSessionStore(
    useShallow((state) => {
      if (!kinds.agents || !expanded) return EMPTY_IDS;
      const session = state.sessions[serverId];
      if (!session?.agents) return EMPTY_IDS;
      return selectWorkspaceSessionAgentIds({
        agents: session.agents,
        agentDetails: session.agentDetails,
        workspaceId,
        hiddenAgentIds,
        tabs,
      });
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

  const storedOrder = useSidebarOrderStore(
    (state) => state.sessionOrderByWorkspace[layoutKey] ?? EMPTY_IDS,
  );
  const rows = useMemo(
    () =>
      applyStoredOrdering({
        items: orderWorkspaceSessions({ tabs, agentIds, terminalIds, kinds }),
        storedOrder,
        getKey: sessionRowKey,
      }),
    [tabs, agentIds, terminalIds, kinds, storedOrder],
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
}: {
  workspace: SidebarWorkspaceEntry;
  sessions: WorkspaceSessionRows;
  workspaceSelected: boolean;
}) {
  const { simultaneousGestureRef, gestureHostPresented } = useContext(WorkspaceSessionListContext);
  const handleDragEnd = useCallback(
    (rows: WorkspaceSessionRow[]) => {
      const store = useSidebarOrderStore.getState();
      store.setSessionOrder(
        workspace.workspaceKey,
        mergeWithRemainder({
          currentOrder: store.sessionOrderByWorkspace[workspace.workspaceKey] ?? EMPTY_IDS,
          reorderedVisibleKeys: rows.map(sessionRowKey),
        }),
      );
    },
    [workspace.workspaceKey],
  );
  const renderRow = useCallback(
    ({ item, drag, isActive, dragHandleProps }: DraggableRenderItemInfo<WorkspaceSessionRow>) => (
      <WorkspaceSessionRowItem
        row={item}
        serverId={workspace.serverId}
        workspaceId={workspace.workspaceId}
        selected={workspaceSelected && item.tabId !== null && item.tabId === sessions.focusedTabId}
        drag={drag}
        isDragging={isActive}
        dragHandleProps={dragHandleProps}
      />
    ),
    [workspace.serverId, workspace.workspaceId, workspaceSelected, sessions.focusedTabId],
  );
  if (sessions.rows.length === 0) return null;
  return (
    <View style={styles.list} testID={`sidebar-workspace-sessions-${workspace.workspaceKey}`}>
      <DraggableList
        data={sessions.rows}
        keyExtractor={sessionRowKey}
        renderItem={renderRow}
        onDragEnd={handleDragEnd}
        scrollEnabled={false}
        useDragHandle
        nestable={isNative}
        simultaneousGestureRef={simultaneousGestureRef}
        gestureHostPresented={gestureHostPresented}
        extraData={sessions.focusedTabId}
      />
    </View>
  );
});

const WorkspaceSessionRowItem = memo(function WorkspaceSessionRowItem({
  row,
  serverId,
  workspaceId,
  selected,
  drag,
  isDragging,
  dragHandleProps,
}: {
  row: WorkspaceSessionRow;
  serverId: string;
  workspaceId: string;
  selected: boolean;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  const { t } = useTranslation();
  const tab = useMemo<WorkspaceTabDescriptor>(
    () => ({
      key: row.key,
      tabId: row.tabId ?? buildDeterministicWorkspaceTabId(row.target),
      kind: row.target.kind,
      target: row.target,
    }),
    [row],
  );
  const { onPress: onSessionPress } = useContext(WorkspaceSessionListContext);
  const didDragRef = useRef(false);
  const handlePressIn = useCallback(() => {
    didDragRef.current = false;
  }, []);
  const handleLongPress = useCallback(() => {
    didDragRef.current = true;
    drag();
  }, [drag]);
  const handlePress = useCallback(() => {
    if (didDragRef.current) return;
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
  const kebab = useOpenKebabMenuVisibility(isHovered || isNative || isCompact);

  const content = (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <SessionRowHoverTarget
          row={row}
          serverId={serverId}
          presentation={presentation}
          isDragging={isDragging}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        >
          <Pressable
            {...dragHandleProps?.attributes}
            {...dragHandleProps?.listeners}
            ref={dragHandleProps?.setActivatorNodeRef}
            onPressIn={handlePressIn}
            onLongPress={isNative ? handleLongPress : undefined}
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
                  {kebab.showKebab ? (
                    <WorkspaceSessionKebab
                      layoutKey={layoutKey}
                      tab={tab}
                      serverId={serverId}
                      workspaceId={workspaceId}
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
  return (
    <DropdownMenu compactMode="sheet" {...kebab.menuProps}>
      {content}
    </DropdownMenu>
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
  isDragging,
  onPointerEnter,
  onPointerLeave,
  children,
}: {
  row: WorkspaceSessionRow;
  serverId: string;
  presentation: WorkspaceTabPresentation;
  isDragging: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  children: ReactElement;
}) {
  const { open } = useContextMenu();
  return (
    <ContextMenuTrigger
      contextOnly
      enabledOnMobile={false}
      style={styles.hoverTarget}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <Tooltip
        delayDuration={300}
        enabledOnDesktop={!open && !isDragging}
        enabledOnMobile={false}
        interactive
      >
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          testID={`sidebar-workspace-session-tooltip-${row.key}`}
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
    </ContextMenuTrigger>
  );
}

function WorkspaceSessionKebab({
  layoutKey,
  tab,
  serverId,
  workspaceId,
  label,
}: {
  layoutKey: string;
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  label: string;
}) {
  const { open } = useContextMenu();
  const { tabId } = tab;
  const isCompact = useIsCompactFormFactor();
  const builder = useWorkspaceTabMenuRegistry((state) => state.builders[layoutKey]);
  const layout = useWorkspaceLayoutStore((state) => state.layoutByWorkspace[layoutKey]);
  const aiRename = useAiRename(serverId, ConversationTitleTarget.Agent);
  const onMarkAgentUnread = useMarkAgentUnread(serverId);
  let entries: WorkspaceTabMenuEntry[] = [];
  if (open) {
    const layoutState = useWorkspaceLayoutStore.getState();
    const pane = layout && findPaneContainingTab(layout.root, tabId);
    const tabIds = pane?.tabIds ?? [tabId];
    const select = (entryKey: string) =>
      selectWorkspaceTabMenuEntry({ serverId, workspaceId, tab, entryKey });
    entries =
      builder?.(tabId) ??
      buildWorkspaceTabMenuEntries({
        surface: "desktop",
        tab,
        index: tabIds.indexOf(tabId),
        tabCount: tabIds.length,
        menuTestIDBase: `workspace-tab-context-${tabId}`,
        onCopyResumeCommand: () => select("copy-resume-command"),
        onCopyAgentId: () => select("copy-agent-id"),
        onCopyTerminalId: () => select("copy-terminal-id"),
        onCopyFilePath: () => select("copy-file-path"),
        onRevealFileInExplorer: () => select("reveal-in-explorer"),
        onReloadAgent: () => select("reload-agent"),
        onRenameTab: () => select("rename"),
        onRenameTabWithAi: aiRename.supported ? aiRename.rename : undefined,
        onMarkAgentUnread,
        renameWithAiPendingIds: aiRename.pendingIds,
        onCloseTab: () => select("close"),
        onCloseTabsBefore: () => select("close-before"),
        onCloseTabsAfter: () => select("close-after"),
        onCloseOtherTabs: () => select("close-others"),
        paneMoves:
          layout && !isCompact && supportsDesktopPaneSplits()
            ? {
                root: layout.root,
                explorerSidebarPaneId: selectExplorerSidebarPaneId(layoutState, layoutKey),
                workspaceKey: layoutKey,
                moveTabToPane: layoutState.moveTabToPane,
                splitPane: layoutState.splitPane,
              }
            : undefined,
      });
  }
  return (
    <>
      <DropdownMenuTrigger
        hitSlop={8}
        style={sidebarKebabTriggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={label}
        testID={`sidebar-workspace-session-kebab-${tabId}`}
      >
        {renderSidebarKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={260}
        sheetTitle={label}
        testID={`sidebar-workspace-session-menu-${tabId}`}
      >
        {entries.map((entry) =>
          entry.kind === "separator" ? (
            <DropdownMenuSeparator key={entry.key} />
          ) : (
            <WorkspaceSessionMenuItem key={entry.key} entry={entry} />
          ),
        )}
      </DropdownMenuContent>
    </>
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

/** Model, effort, turns, and session cost; each part is left out when the agent doesn't report it. */
function AgentTooltipMeta({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { model, effort, turns, cost } = useAgentMetaParts({ serverId, agentId });
  const parts = [model, effort, turns, cost].filter(Boolean);
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
