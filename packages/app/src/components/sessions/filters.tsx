/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import {
  Archive,
  Bot,
  Cpu,
  PanelsTopLeft,
  Network,
  Server,
  SlidersHorizontal,
  X,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import type { AgentHistoryFilterOptions } from "@getpaseo/protocol/messages";
import {
  MenuRoot,
  MenuTrigger,
  MenuSurface,
  MenuItem,
  MenuLabel,
  MenuSelectionHeader,
  MenuSeparator,
  type MenuTriggerState,
} from "@/components/ui/menu";
import {
  allFilterOptionsSelected,
  toggleFilterOption,
  type FilterSelection,
} from "@/utils/filter-selection";
import { toolbarLabelTriggerStyle } from "@/components/ui/toolbar-label-trigger";
import { Button } from "@/components/ui/button";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import { HostStatusDot } from "@/components/host-status-dot";
import { ProviderIcon } from "@/components/provider-icons";
import { ProjectIconView } from "@/components/project-icon-view";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import {
  EMPTY_HISTORY_FILTERS,
  HistoryStatus,
  HistoryAgentType,
  type HistoryFilters,
} from "./preferences";

export function historyModelKey(model: AgentHistoryFilterOptions["models"][number]): string {
  return JSON.stringify([model.provider, model.model]);
}

const providerLabels = new Map(
  AGENT_PROVIDER_DEFINITIONS.map((provider) => [provider.id, provider.label]),
);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedArchive = withUnistyles(Archive);
const ThemedBot = withUnistyles(Bot);
const ThemedCpu = withUnistyles(Cpu);
const ThemedPanels = withUnistyles(PanelsTopLeft);
const ThemedNetwork = withUnistyles(Network);
const ThemedServer = withUnistyles(Server);
const ThemedSliders = withUnistyles(SlidersHorizontal);

type FilterOption = { id: string; label: string; leading?: ReactElement };
type FilterGroup = {
  id: keyof HistoryFilters;
  title: string;
  all: string;
  none: string;
  options: FilterOption[];
  selected: FilterSelection;
  icon: ReactElement;
  disabled?: boolean;
};

function FilterItems({
  group,
  filters,
  options,
  onChange,
}: {
  group: FilterGroup;
  filters: HistoryFilters;
  options: AgentHistoryFilterOptions;
  onChange: (filters: HistoryFilters) => void;
}) {
  const optionIds = group.options.map((option) => option.id);
  const allSelected = allFilterOptionsSelected({ selection: group.selected, options: optionIds });
  const changeSelection = useCallback(
    (selection: string[] | null) => {
      if (group.id === "agentType") {
        let agentType = HistoryAgentType.All;
        if (!selection) agentType = HistoryAgentType.None;
        else if (selection.includes(HistoryAgentType.Main)) agentType = HistoryAgentType.Main;
        else if (selection.includes(HistoryAgentType.Subagent))
          agentType = HistoryAgentType.Subagent;
        onChange({ ...filters, agentType });
      } else if (group.id === "status") {
        let status = HistoryStatus.All;
        if (!selection) status = HistoryStatus.None;
        else if (selection.includes(HistoryStatus.Active)) status = HistoryStatus.Active;
        else if (selection.includes(HistoryStatus.Archived)) status = HistoryStatus.Archived;
        onChange({ ...filters, status });
      } else if (group.id === "models") {
        const available = new Map(
          [...options.models, ...(filters.models ?? [])].map((model) => [
            historyModelKey(model),
            model,
          ]),
        );
        const models =
          selection &&
          [...available.values()].filter((model) => selection.includes(historyModelKey(model)));
        onChange({ ...filters, models });
      } else {
        onChange({ ...filters, [group.id]: selection });
      }
    },
    [filters, group.id, onChange, options.models],
  );
  const toggleAll = useCallback(
    () => changeSelection(allSelected ? null : []),
    [changeSelection, allSelected],
  );
  const select = useCallback(
    (id: string) => {
      changeSelection(
        toggleFilterOption({
          selection: group.selected,
          options: group.options.map((option) => option.id),
          id,
        }),
      );
    },
    [changeSelection, group.selected, group.options],
  );
  const items = useMemo(
    () => group.options.map((option) => ({ ...option, onSelect: () => select(option.id) })),
    [group.options, select],
  );
  return (
    <>
      <MenuSelectionHeader
        allSelected={allSelected}
        onToggleAll={toggleAll}
        testID={`sessions-${group.id}-filter-all`}
      >
        {group.title}
      </MenuSelectionHeader>
      {items.map((option) => (
        <MenuItem
          key={option.id}
          leading={option.leading}
          selected={group.selected?.length === 0 || !!group.selected?.includes(option.id)}
          closeOnSelect={false}
          onSelect={option.onSelect}
          testID={`sessions-${group.id}-filter-item-${option.id}`}
        >
          {option.label}
        </MenuItem>
      ))}
    </>
  );
}

export function hasHistoryFilters(filters: HistoryFilters): boolean {
  return (
    filters.hosts?.length !== 0 ||
    filters.projects?.length !== 0 ||
    filters.providers?.length !== 0 ||
    filters.models?.length !== 0 ||
    filters.status !== HistoryStatus.All ||
    filters.agentType !== HistoryAgentType.All
  );
}

function filterLabel(group: FilterGroup): string {
  if (group.disabled) return group.title;
  if (
    allFilterOptionsSelected({
      selection: group.selected,
      options: group.options.map((option) => option.id),
    })
  )
    return group.all;
  if (!group.selected) return group.none;
  const selected = group.selected;
  if (selected.length === 1)
    return group.options.find((option) => option.id === selected[0])?.label ?? group.title;
  return `${group.title} (${group.selected.length})`;
}

export function HistoryFilterBar({
  filters,
  options,
  supported,
  agentTypeSupported,
  onChange,
}: {
  filters: HistoryFilters;
  options: AgentHistoryFilterOptions;
  supported: boolean;
  agentTypeSupported: boolean;
  onChange: (filters: HistoryFilters) => void;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const compact = useIsCompactFormFactor();
  const groups = useMemo<FilterGroup[]>(() => {
    let agentTypes: FilterSelection = [filters.agentType];
    if (filters.agentType === HistoryAgentType.All) agentTypes = [];
    if (filters.agentType === HistoryAgentType.None) agentTypes = null;
    let statuses: FilterSelection = [filters.status];
    if (filters.status === HistoryStatus.All) statuses = [];
    if (filters.status === HistoryStatus.None) statuses = null;
    const projects = new Map(options.projects.map((project) => [project.projectKey, project]));
    const models = new Map(options.models.map((model) => [historyModelKey(model), model]));
    const providers = [...new Set(options.models.map((model) => model.provider))].sort();
    return [
      {
        id: "hosts",
        title: t("sessions.filters.hosts"),
        all: t("sidebar.display.hostFilter.all"),
        none: t("sessions.filters.noHosts"),
        selected: filters.hosts,
        icon: <ThemedServer size={14} uniProps={mutedIconMapping} />,
        options: hosts.map((host) => ({
          id: host.serverId,
          label: host.label || host.serverId,
          leading: <HostStatusDot serverId={host.serverId} />,
        })),
      },
      {
        id: "projects",
        title: t("sessions.filters.projects"),
        all: t("sidebar.display.projectFilter.all"),
        none: t("sessions.filters.noProjects"),
        selected: filters.projects,
        icon: <ThemedPanels size={14} uniProps={mutedIconMapping} />,
        disabled: !supported,
        options: [...projects.values()]
          .sort((a, b) => a.projectName.localeCompare(b.projectName))
          .map((project) => ({
            id: project.projectKey,
            label: project.projectName,
            leading: (
              <ProjectIconView
                iconDataUri={null}
                initial={project.projectName.charAt(0).toUpperCase()}
                projectViewKey={project.projectKey}
                size={14}
                textStyle={styles.projectIconText}
              />
            ),
          })),
      },
      {
        id: "providers",
        title: t("sessions.filters.provider"),
        all: t("sessions.filters.allProviders"),
        none: t("sessions.filters.noProviders"),
        selected: filters.providers,
        icon: <ThemedBot size={14} uniProps={mutedIconMapping} />,
        disabled: !supported,
        options: providers.map((provider) => ({
          id: provider,
          label: providerLabels.get(provider) ?? provider,
          leading: <ProviderIcon provider={provider} size={14} uniProps={mutedIconMapping} />,
        })),
      },
      {
        id: "models",
        title: t("sessions.filters.model"),
        all: t("sessions.filters.allModels"),
        none: t("sessions.filters.noModels"),
        selected: filters.models && filters.models.map(historyModelKey),
        icon: <ThemedCpu size={14} uniProps={mutedIconMapping} />,
        disabled: !supported,
        options: [...models.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, model]) => ({
            id,
            label: model.model ?? t("sessions.filters.unknownModel"),
            leading: (
              <ProviderIcon provider={model.provider} size={14} uniProps={mutedIconMapping} />
            ),
          })),
      },
      {
        id: "agentType",
        title: t("sessions.filters.agentType"),
        all: t("sessions.filters.allAgents"),
        none: t("sessions.filters.noAgents"),
        selected: agentTypes,
        icon: <ThemedNetwork size={14} uniProps={mutedIconMapping} />,
        disabled: !supported || !agentTypeSupported,
        options: [
          { id: HistoryAgentType.Main, label: t("sessions.filters.mainAgents") },
          { id: HistoryAgentType.Subagent, label: t("sessions.filters.subagents") },
        ],
      },
      {
        id: "status",
        title: t("sessions.filters.status"),
        all: t("sessions.filters.allSessions"),
        none: t("sessions.filters.noSessions"),
        selected: statuses,
        icon: <ThemedArchive size={14} uniProps={mutedIconMapping} />,
        disabled: !supported,
        options: [
          { id: HistoryStatus.Active, label: t("sessions.filters.active") },
          { id: HistoryStatus.Archived, label: t("agentList.badges.archived") },
        ],
      },
    ];
  }, [filters, hosts, options, supported, agentTypeSupported, t]);
  const activeCount = groups.filter(
    (group) =>
      !group.disabled &&
      !allFilterOptionsSelected({
        selection: group.selected,
        options: group.options.map((option) => option.id),
      }),
  ).length;

  const clear = useCallback(() => onChange(EMPTY_HISTORY_FILTERS), [onChange]);

  if (compact)
    return (
      <MenuRoot compactMode="sheet">
        <MenuTrigger
          accessibilityRole="button"
          style={filterTriggerStyle}
          accessibilityLabel={t("sessions.filters.title")}
          testID="sessions-filters-trigger"
        >
          <ThemedSliders size={14} uniProps={mutedIconMapping} />
          <Text style={styles.triggerText}>
            {t("sessions.filters.title")}
            {activeCount ? ` (${activeCount})` : ""}
          </Text>
        </MenuTrigger>
        <MenuSurface
          sheetTitle={t("sessions.filters.title")}
          testID="sessions-filters-sheet"
          scrollable
        >
          {groups.map((group) => (
            <View key={group.id}>
              {group.disabled ? (
                <>
                  <MenuLabel>{group.title}</MenuLabel>
                  <Text style={styles.hint}>{t("sessions.filters.updateHost")}</Text>
                </>
              ) : (
                <FilterItems
                  group={group}
                  filters={filters}
                  options={options}
                  onChange={onChange}
                />
              )}
              <MenuSeparator />
            </View>
          ))}
          <MenuItem closeOnSelect={false} onSelect={clear}>
            {t("sessions.filters.clear")}
          </MenuItem>
        </MenuSurface>
      </MenuRoot>
    );

  return (
    <View style={styles.bar}>
      {groups.map((group) => (
        <MenuRoot key={group.id}>
          <MenuTrigger
            accessibilityRole="button"
            style={filterTriggerStyle}
            testID={`sessions-${group.id}-filter-trigger`}
            accessibilityLabel={`${group.title}: ${filterLabel(group)}`}
          >
            {group.icon}
            <Text style={styles.triggerText} numberOfLines={1}>
              {filterLabel(group)}
            </Text>
          </MenuTrigger>
          <MenuSurface width={280} maxHeight={400} scrollable>
            {group.disabled ? (
              <>
                <MenuLabel>{group.title}</MenuLabel>
                <Text style={styles.hint}>{t("sessions.filters.updateHost")}</Text>
              </>
            ) : (
              <FilterItems group={group} filters={filters} options={options} onChange={onChange} />
            )}
          </MenuSurface>
        </MenuRoot>
      ))}
      {!supported ? <Text style={styles.hint}>{t("sessions.filters.updateHost")}</Text> : null}
      {activeCount ? (
        <View style={styles.clearGroup}>
          <View style={styles.clearDivider} />
          <Button size="sm" variant="ghost" leftIcon={X} onPress={clear}>
            {t("sessions.filters.clear")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function filterTriggerStyle(state: MenuTriggerState) {
  return [toolbarLabelTriggerStyle(state), styles.trigger];
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: buttonControlHeight.sm,
  },
  clearGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  clearDivider: {
    width: theme.borderWidth[1],
    height: theme.spacing[4],
    backgroundColor: theme.colors.border,
  },
  trigger: {
    minHeight: buttonControlHeight.sm,
    paddingHorizontal: theme.spacing[2],
    maxWidth: 260,
  },
  triggerText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  projectIconText: { fontSize: 8 },
}));
