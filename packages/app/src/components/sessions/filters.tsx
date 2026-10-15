/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import {
  Archive,
  Bot,
  Cpu,
  PanelsTopLeft,
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
  MenuSeparator,
  type MenuTriggerState,
} from "@/components/ui/menu";
import { toolbarLabelTriggerStyle } from "@/components/ui/toolbar-label-trigger";
import { Button } from "@/components/ui/button";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import { HostStatusDot } from "@/components/host-status-dot";
import { ProviderIcon } from "@/components/provider-icons";
import { ProjectIconView } from "@/components/project-icon-view";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { EMPTY_HISTORY_FILTERS, HistoryStatus, type HistoryFilters } from "./preferences";

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
const ThemedServer = withUnistyles(Server);
const ThemedSliders = withUnistyles(SlidersHorizontal);

type FilterOption = { id: string; label: string; leading?: ReactElement };
type FilterGroup = {
  id: keyof HistoryFilters;
  title: string;
  all: string;
  options: FilterOption[];
  selected: string[];
  icon: ReactElement;
  disabled?: boolean;
};

function FilterItems({
  group,
  filters,
  options,
  closeOnSelect = false,
  onChange,
}: {
  group: FilterGroup;
  filters: HistoryFilters;
  options: AgentHistoryFilterOptions;
  closeOnSelect?: boolean;
  onChange: (filters: HistoryFilters) => void;
}) {
  const select = useCallback(
    (id: string) => {
      if (group.id === "status") {
        let status = HistoryStatus.All;
        if (id === HistoryStatus.Active) status = HistoryStatus.Active;
        if (id === HistoryStatus.Archived) status = HistoryStatus.Archived;
        onChange({ ...filters, status });
        return;
      }
      if (group.id === "models") {
        const model = options.models.find((option) => historyModelKey(option) === id);
        const remaining = filters.models.filter((option) => historyModelKey(option) !== id);
        const models = group.selected.includes(id) || !model ? remaining : [...remaining, model];
        onChange({ ...filters, models: id ? models : [] });
        return;
      }
      const current = filters[group.id];
      const values = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id];
      onChange({ ...filters, [group.id]: id ? values : [] });
    },
    [filters, group.id, group.selected, onChange, options.models],
  );
  const selectAll = useCallback(() => select(""), [select]);
  const items = useMemo(
    () => group.options.map((option) => ({ ...option, onSelect: () => select(option.id) })),
    [group.options, select],
  );
  return (
    <>
      <MenuItem
        selected={!group.selected.length}
        closeOnSelect
        onSelect={selectAll}
        testID={`sessions-${group.id}-filter-all`}
      >
        {group.all}
      </MenuItem>
      {items.map((option) => (
        <MenuItem
          key={option.id}
          leading={option.leading}
          selected={group.selected.includes(option.id)}
          closeOnSelect={closeOnSelect}
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
    filters.hosts.length > 0 ||
    filters.projects.length > 0 ||
    filters.providers.length > 0 ||
    filters.models.length > 0 ||
    filters.status !== HistoryStatus.All
  );
}

function filterLabel(group: FilterGroup): string {
  if (group.disabled) return group.title;
  if (!group.selected.length) return group.all;
  if (group.selected.length === 1)
    return group.options.find((option) => option.id === group.selected[0])?.label ?? group.title;
  return `${group.title} (${group.selected.length})`;
}

export function HistoryFilterBar({
  filters,
  options,
  supported,
  onChange,
}: {
  filters: HistoryFilters;
  options: AgentHistoryFilterOptions;
  supported: boolean;
  onChange: (filters: HistoryFilters) => void;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const compact = useIsCompactFormFactor();
  const groups = useMemo<FilterGroup[]>(() => {
    const projects = new Map(options.projects.map((project) => [project.projectKey, project]));
    const models = new Map(options.models.map((model) => [historyModelKey(model), model]));
    const providers = [...new Set(options.models.map((model) => model.provider))].sort();
    return [
      {
        id: "hosts",
        title: t("sessions.filters.hosts"),
        all: t("sidebar.display.hostFilter.all"),
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
        selected: filters.models.map(historyModelKey),
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
        id: "status",
        title: t("sessions.filters.status"),
        all: t("sessions.filters.allSessions"),
        selected: filters.status === HistoryStatus.All ? [] : [filters.status],
        icon: <ThemedArchive size={14} uniProps={mutedIconMapping} />,
        disabled: !supported,
        options: [
          { id: HistoryStatus.Active, label: t("sessions.filters.active") },
          { id: HistoryStatus.Archived, label: t("agentList.badges.archived") },
        ],
      },
    ];
  }, [filters, hosts, options, supported, t]);
  const activeCount = groups.filter((group) => !group.disabled && group.selected.length).length;

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
              <MenuLabel>{group.title}</MenuLabel>
              {group.disabled ? (
                <Text style={styles.hint}>{t("sessions.filters.updateHost")}</Text>
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
              <Text style={styles.hint}>{t("sessions.filters.updateHost")}</Text>
            ) : (
              <FilterItems
                group={group}
                filters={filters}
                options={options}
                closeOnSelect={group.id === "status"}
                onChange={onChange}
              />
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
