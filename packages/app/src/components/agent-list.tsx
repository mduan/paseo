import {
  View,
  Text,
  Pressable,
  Modal,
  RefreshControl,
  FlatList,
  type ListRenderItem,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSessionStore } from "@/stores/session-store";
import { Archive, ChevronRight, Folder, GitBranch, Server } from "lucide-react-native";
import { ProviderIcon } from "@/components/provider-icons";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { formatSessionCost, resolveAgentCostBreakdown } from "@/components/agent-cost";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import { ProjectIconView } from "@/components/project-icon-view";
import type { Theme } from "@/styles/theme";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { findHighlightRanges } from "@/components/ui/highlighted-text-segments";

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const refreshColorMapping = (theme: Theme) => ({
  tintColor: theme.colors.foregroundMuted,
  colors: [theme.colors.foregroundMuted],
});
const ThemedArchive = withUnistyles(Archive);
const ThemedFolder = withUnistyles(Folder);
const ThemedBranch = withUnistyles(GitBranch);
const ThemedServer = withUnistyles(Server);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedRefreshControl = withUnistyles(RefreshControl);

interface AgentListProps {
  agents: AggregatedAgent[];
  showCheckoutInfo?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  selectedAgentId?: string;
  onAgentSelect?: () => void;
  listFooterComponent?: ReactElement | null;
  showAttentionIndicator?: boolean;
  showHostColumn?: boolean;
  search?: string;
}

type DateSectionKey = "today" | "yesterday" | "thisWeek" | "thisMonth" | "older";

const DATE_SECTION_ORDER = [
  "today",
  "yesterday",
  "thisWeek",
  "thisMonth",
  "older",
] as const satisfies readonly DateSectionKey[];

type FlatListItem =
  | { type: "header"; key: string; section: DateSectionKey }
  | { type: "agent"; key: string; agent: AggregatedAgent };

function deriveDateSectionKey(lastActivityAt: Date): DateSectionKey {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const activityStart = new Date(
    lastActivityAt.getFullYear(),
    lastActivityAt.getMonth(),
    lastActivityAt.getDate(),
  );

  if (activityStart.getTime() >= todayStart.getTime()) {
    return "today";
  }
  if (activityStart.getTime() >= yesterdayStart.getTime()) {
    return "yesterday";
  }

  const diffTime = todayStart.getTime() - activityStart.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) {
    return "thisWeek";
  }
  if (diffDays <= 30) {
    return "thisMonth";
  }
  return "older";
}

function formatDateSectionLabel(t: TFunction, section: DateSectionKey): string {
  switch (section) {
    case "today":
      return t("agentList.dateSections.today");
    case "yesterday":
      return t("agentList.dateSections.yesterday");
    case "thisWeek":
      return t("agentList.dateSections.thisWeek");
    case "thisMonth":
      return t("agentList.dateSections.thisMonth");
    case "older":
      return t("agentList.dateSections.older");
  }
}

function SessionBadge({
  label,
  icon,
  tone = "neutral",
}: {
  label: string;
  icon?: ReactElement;
  tone?: "neutral" | "warning" | "danger";
}) {
  let variant: StatusBadgeVariant = "muted";
  if (tone === "warning") variant = "warning";
  else if (tone === "danger") variant = "error";
  return <StatusBadge label={label} variant={variant} leading={icon} />;
}

function SessionRowBadges({
  agent,
  archivedIcon,
  pendingPermissionCount,
  showAttention,
}: {
  agent: AggregatedAgent;
  archivedIcon: ReactElement;
  pendingPermissionCount: number;
  showAttention: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {agent.archivedAt ? (
        <SessionBadge label={t("agentList.badges.archived")} icon={archivedIcon} />
      ) : null}
      {pendingPermissionCount > 0 ? (
        <SessionBadge
          label={t("agentList.badges.pending", { count: pendingPermissionCount })}
          tone="warning"
        />
      ) : null}
      {showAttention ? (
        <SessionBadge label={t("agentList.badges.attention")} tone="danger" />
      ) : null}
    </>
  );
}

function SessionRow({
  agent,
  search,
  isMobile,
  selectedAgentId,
  showAttentionIndicator,
  showHostColumn,
  onPress,
  onLongPress,
}: {
  agent: AggregatedAgent;
  search?: string;
  isMobile: boolean;
  selectedAgentId?: string;
  showAttentionIndicator: boolean;
  showHostColumn: boolean;
  onPress: (agent: AggregatedAgent) => void;
  onLongPress: (agent: AggregatedAgent) => void;
}) {
  const { t } = useTranslation();
  const agentKey = `${agent.serverId}:${agent.id}`;
  const isSelected = selectedAgentId === agentKey;
  const projectName = agent.projectPlacement?.projectName ?? "";
  const branch = agent.projectPlacement?.checkout.currentBranch ?? "";
  const workspaceName = agent.projectPlacement?.workspaceName ?? "";
  const pendingPermissionCount = agent.pendingPermissionCount ?? 0;
  const ranges = useMemo(
    () => ({
      workspace: findHighlightRanges(search ?? "", workspaceName),
      title: findHighlightRanges(search ?? "", agent.title ?? ""),
      branch: findHighlightRanges(search ?? "", branch),
      project: findHighlightRanges(search ?? "", projectName),
    }),
    [search, workspaceName, agent.title, branch, projectName],
  );

  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      isSelected && styles.rowSelected,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isSelected],
  );

  const handlePress = useCallback(() => onPress(agent), [onPress, agent]);
  const handleLongPress = useCallback(() => onLongPress(agent), [onLongPress, agent]);

  const archivedIcon = useMemo(() => <ThemedArchive size={12} uniProps={mutedIconMapping} />, []);
  const showAttention = showAttentionIndicator && Boolean(agent.requiresAttention);

  return (
    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      onLongPress={handleLongPress}
      accessibilityRole="button"
      testID={`agent-row-${agent.serverId}-${agent.id}`}
    >
      <View style={styles.rowContent}>
        <View style={styles.rowTitleRow}>
          <HighlightedText
            text={agent.title || t("agentList.fallbackTitle")}
            ranges={ranges.title}
            style={styles.sessionTitle}
            numberOfLines={isMobile ? 2 : 1}
            testID={`agent-row-title-${agent.serverId}-${agent.id}`}
          />
          <View style={styles.rowEnd}>
            <SessionRowBadges
              agent={agent}
              archivedIcon={archivedIcon}
              pendingPermissionCount={pendingPermissionCount}
              showAttention={showAttention}
            />
            <AgentActivityTime date={agent.lastActivityAt} />
          </View>
        </View>
        <View style={styles.rowMetaRow}>
          <View style={styles.metaItem}>
            {projectName ? (
              <View style={styles.metaItem}>
                <ProjectIconView
                  iconDataUri={null}
                  initial={projectName.charAt(0).toUpperCase()}
                  projectViewKey={agent.projectPlacement?.projectKey ?? agent.cwd}
                  size={14}
                  textStyle={styles.projectIconText}
                />
                <HighlightedText
                  text={projectName}
                  ranges={ranges.project}
                  style={styles.sessionMetaText}
                  numberOfLines={1}
                  testID={`agent-row-project-${agent.serverId}-${agent.id}`}
                />
              </View>
            ) : null}
            {workspaceName ? (
              <View style={styles.metaItem}>
                <ThemedChevronRight size={12} uniProps={mutedIconMapping} />
                <ThemedFolder size={14} uniProps={mutedIconMapping} />
                <HighlightedText
                  text={workspaceName}
                  ranges={ranges.workspace}
                  style={styles.sessionMetaText}
                  numberOfLines={1}
                  testID={`agent-row-workspace-${agent.serverId}-${agent.id}`}
                />
              </View>
            ) : null}
          </View>
          {branch ? (
            <View style={styles.metaItem}>
              <Text style={styles.sessionMetaSeparator}>·</Text>
              <ThemedBranch size={14} uniProps={mutedIconMapping} />
              <HighlightedText
                text={branch}
                ranges={ranges.branch}
                style={styles.sessionMetaText}
                numberOfLines={1}
                testID={`agent-row-branch-${agent.serverId}-${agent.id}`}
              />
            </View>
          ) : null}
          {showHostColumn ? (
            <View style={styles.metaItem}>
              <ThemedServer size={14} uniProps={mutedIconMapping} />
              <Text style={styles.sessionMetaText} numberOfLines={1}>
                {agent.serverLabel}
              </Text>
            </View>
          ) : null}
          <SessionRowModel agent={agent} />
        </View>
      </View>
    </Pressable>
  );
}

function SessionRowModel({ agent }: { agent: AggregatedAgent }) {
  const { t } = useTranslation();
  const usage = agent.lastUsage;
  const breakdown = resolveAgentCostBreakdown({
    totalCostUsd: usage?.totalCostUsd,
    subagentCostUsd: usage?.subagentCostUsd,
    paseoSubagentCostUsd: usage?.paseoSubagentCostUsd,
    totalCostUnavailable: usage?.totalCostUnavailable,
  });
  const costValue = breakdown?.totalCostUsd ?? usage?.totalCostUsd;
  const cost =
    costValue === undefined || agent.lastUsage?.totalCostUnavailable
      ? null
      : formatSessionCost(costValue);
  const estimated = usage?.totalCostEstimated || usage?.paseoSubagentCostEstimated;

  return (
    <View style={[styles.metaItem, styles.modelSummary]}>
      <View style={styles.metaItem}>
        <ProviderIcon
          provider={agent.provider}
          serverId={agent.serverId}
          size={14}
          uniProps={mutedIconMapping}
        />
        <Text style={styles.sessionMetaText} numberOfLines={1}>
          {agent.model ?? t("sessions.filters.unknownModel")}
        </Text>
      </View>
      {agent.thinkingOptionId ? (
        <>
          <Text style={styles.sessionMetaSeparator}>·</Text>
          <Text style={styles.sessionMetaText}>
            {formatThinkingOptionLabel({ id: agent.thinkingOptionId })}
          </Text>
        </>
      ) : null}
      <Text style={styles.sessionMetaSeparator}>·</Text>
      <Text
        style={styles.sessionMetaText}
        accessibilityLabel={
          estimated && cost ? t("sessions.filters.estimatedCost", { cost }) : undefined
        }
      >
        {cost ? `${estimated ? "~" : ""}${cost}` : t("sessions.filters.costUnavailable")}
      </Text>
    </View>
  );
}

function AgentActivityTime({ date }: { date: Date }) {
  const label = useTimeAgo(date);
  return (
    <Text style={styles.activityTime} numberOfLines={1}>
      {label}
    </Text>
  );
}

export function AgentList({
  agents,
  isRefreshing = false,
  onRefresh,
  selectedAgentId,
  onAgentSelect,
  listFooterComponent,
  showAttentionIndicator = true,
  showHostColumn = false,
  search,
}: AgentListProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [actionAgent, setActionAgent] = useState<AggregatedAgent | null>(null);
  const isMobile = useIsCompactFormFactor();
  const { archiveAgent } = useArchiveAgent();

  const actionClient = useSessionStore((state) =>
    actionAgent?.serverId ? (state.sessions[actionAgent.serverId]?.client ?? null) : null,
  );

  const isActionSheetVisible = actionAgent !== null;
  const isActionDaemonUnavailable = Boolean(actionAgent?.serverId && !actionClient);

  const handleAgentPress = useCallback(
    (agent: AggregatedAgent) => {
      if (isActionSheetVisible) {
        return;
      }

      const serverId = agent.serverId;
      const agentId = agent.id;

      onAgentSelect?.();
      navigateToAgent({
        serverId,
        agentId,
        workspaceId: agent.workspaceId,
        pin: true,
      });
    },
    [isActionSheetVisible, onAgentSelect],
  );

  const handleAgentLongPress = useCallback(
    (agent: AggregatedAgent) => {
      const isRunning = agent.status === "running";
      if (isRunning) {
        setActionAgent(agent);
        return;
      }

      const client = useSessionStore.getState().sessions[agent.serverId]?.client ?? null;
      if (!client) {
        setActionAgent(agent);
        return;
      }
      void archiveAgent({ serverId: agent.serverId, agentId: agent.id }).catch(() => {});
    },
    [archiveAgent],
  );

  const handleCloseActionSheet = useCallback(() => {
    setActionAgent(null);
  }, []);

  const handleArchiveAgent = useCallback(() => {
    if (!actionAgent || !actionClient) {
      return;
    }
    // Timeout errors are swallowed — the daemon will still process the archive
    void archiveAgent({ serverId: actionAgent.serverId, agentId: actionAgent.id }).catch(() => {});
    setActionAgent(null);
  }, [actionAgent, actionClient, archiveAgent]);

  const flatItems = useMemo((): FlatListItem[] => {
    const buckets = new Map<DateSectionKey, AggregatedAgent[]>();
    for (const agent of agents) {
      const section = deriveDateSectionKey(agent.lastActivityAt);
      const existing = buckets.get(section) ?? [];
      existing.push(agent);
      buckets.set(section, existing);
    }

    const result: FlatListItem[] = [];
    for (const section of DATE_SECTION_ORDER) {
      const data = buckets.get(section);
      if (!data || data.length === 0) {
        continue;
      }
      result.push({ type: "header", key: `header:${section}`, section });
      for (const agent of data) {
        result.push({ type: "agent", key: `${agent.serverId}:${agent.id}`, agent });
      }
    }
    return result;
  }, [agents]);

  const renderItem: ListRenderItem<FlatListItem> = useCallback(
    ({ item }) => {
      if (item.type === "header") {
        return (
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>{formatDateSectionLabel(t, item.section)}</Text>
          </View>
        );
      }
      return (
        <SessionRow
          agent={item.agent}
          search={search}
          isMobile={isMobile}
          selectedAgentId={selectedAgentId}
          showAttentionIndicator={showAttentionIndicator}
          showHostColumn={showHostColumn}
          onPress={handleAgentPress}
          onLongPress={handleAgentLongPress}
        />
      );
    },
    [
      handleAgentLongPress,
      handleAgentPress,
      isMobile,
      search,
      selectedAgentId,
      showAttentionIndicator,
      showHostColumn,
      t,
    ],
  );

  const keyExtractor = useCallback((item: FlatListItem) => item.key, []);

  const sheetContainerStyle = useMemo(
    () => [styles.sheetContainer, { paddingBottom: Math.max(insets.bottom, 24) }],
    [insets.bottom],
  );
  const sheetArchiveTextStyle = useMemo(
    () => [styles.sheetArchiveText, isActionDaemonUnavailable && styles.sheetArchiveTextDisabled],
    [isActionDaemonUnavailable],
  );

  const refreshControl = useMemo(
    () =>
      onRefresh ? (
        <ThemedRefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          uniProps={refreshColorMapping}
        />
      ) : undefined,
    [onRefresh, isRefreshing],
  );

  return (
    <>
      <FlatList
        data={flatItems}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={listFooterComponent}
        refreshControl={refreshControl}
      />

      <Modal
        visible={isActionSheetVisible}
        animationType="fade"
        transparent
        onRequestClose={handleCloseActionSheet}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={handleCloseActionSheet} />
          <View style={sheetContainerStyle}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {isActionDaemonUnavailable
                ? t("agentList.archiveSheet.hostOffline")
                : t("agentList.archiveSheet.runningAgent")}
            </Text>
            <View style={styles.sheetButtonRow}>
              <Pressable
                style={[styles.sheetButton, styles.sheetCancelButton]}
                onPress={handleCloseActionSheet}
                testID="agent-action-cancel"
              >
                <Text style={styles.sheetCancelText}>{t("common.actions.cancel")}</Text>
              </Pressable>
              <Pressable
                disabled={isActionDaemonUnavailable}
                style={[styles.sheetButton, styles.sheetArchiveButton]}
                onPress={handleArchiveAgent}
                testID="agent-action-archive"
              >
                <Text style={sheetArchiveTextStyle}>{t("agentList.archiveSheet.archive")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[1],
  },
  sectionHeading: {
    marginTop: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  sectionTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: {
      xs: theme.borderRadius.lg,
      md: 0,
    },
    marginBottom: {
      xs: theme.spacing[1],
      md: 0,
    },
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: theme.spacing[2],
    overflow: "hidden",
  },
  rowMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: theme.spacing[3],
    rowGap: theme.spacing[1],
    marginTop: theme.spacing[1.5],
  },
  rowSelected: {
    backgroundColor: theme.colors.surface2,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  sessionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  sessionMetaText: {
    flexShrink: 1,
    maxWidth: "100%",
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  sessionMetaSeparator: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    opacity: 0.7,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    maxWidth: "100%",
    flexShrink: 1,
  },
  modelSummary: {
    gap: 3,
  },
  rowEnd: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], flexShrink: 0 },
  activityTime: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  projectIconText: { fontSize: 8 },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheetContainer: {
    backgroundColor: theme.colors.surface2,
    borderTopLeftRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius["2xl"],
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[4],
    gap: theme.spacing[4],
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
    opacity: 0.3,
  },
  sheetTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    textAlign: "center",
  },
  sheetButtonRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  sheetButton: {
    flex: 1,
    borderRadius: theme.borderRadius.lg,
    paddingVertical: theme.spacing[4],
    alignItems: "center",
    justifyContent: "center",
  },
  sheetArchiveButton: {
    backgroundColor: theme.colors.primary,
  },
  sheetArchiveText: {
    color: theme.colors.primaryForeground,
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.base,
  },
  sheetArchiveTextDisabled: {
    opacity: 0.5,
  },
  sheetCancelButton: {
    backgroundColor: theme.colors.surface1,
  },
  sheetCancelText: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.base,
  },
}));
