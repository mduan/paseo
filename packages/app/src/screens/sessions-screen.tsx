import { useMemo, useState, useCallback, useEffect, type ReactElement } from "react";
import { View, Text } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronLeft, Import } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useMutation } from "@tanstack/react-query";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AgentList } from "@/components/agent-list";
import { SearchField } from "@/components/ui/search-field";
import { HistoryFilterBar, hasHistoryFilters } from "@/components/sessions/filters";
import { HistoryDisplayMenu } from "@/components/sessions/display-menu";
import {
  EMPTY_HISTORY_FILTERS,
  HistoryField,
  HistoryStatus,
  type HistoryFilters,
  type HistoryPreferences,
} from "@/components/sessions/preferences";
import type { Theme } from "@/styles/theme";
import { type AgentHistoryHostError, useAgentHistory } from "@/hooks/use-agent-history";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useImportSession } from "@/hooks/use-import-session";
import { useHostRegistryLoaded, useHosts } from "@/runtime/host-runtime";
import { useAppSettings } from "@/hooks/use-settings";
import { buildOpenProjectRoute } from "@/utils/host-routes";

/** Long enough that a typed word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * A host that failed while others answered. Without this the list silently
 * under-reports, and under a query "No sessions match" becomes a claim the app
 * has no basis for.
 */
function SessionHostErrorsBanner({
  errors,
  t,
}: {
  errors: AgentHistoryHostError[];
  t: TFunction;
}): ReactElement {
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="sessions-host-errors">
        {errors.map((error) => (
          <Text key={error.serverId} style={styles.errorsBannerText}>
            {t("sessions.hostLoadFailed", { host: error.serverName })}
          </Text>
        ))}
      </View>
    </View>
  );
}

function HistoryPreferencesError({ visible, onRetry }: { visible: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="sessions-preferences-error">
        <Text style={styles.errorsBannerText}>{t("sessions.display.saveFailed")}</Text>
        <Button variant="ghost" size="sm" onPress={onRetry}>
          {t("common.actions.retry")}
        </Button>
      </View>
    </View>
  );
}

export function SessionsScreen() {
  const isFocused = useIsFocused();
  const { isLoading } = useAppSettings();

  if (!isFocused || isLoading) {
    return <View style={styles.container} />;
  }

  return <SessionsScreenContent />;
}

function SessionsScreenContent() {
  const { t } = useTranslation();
  const importSession = useImportSession();
  const hosts = useHosts();
  const hostsLoaded = useHostRegistryLoaded();
  const { settings, updateSettings } = useAppSettings();
  const { filters, fields } = settings.history;
  const savePreferences = useMutation({
    scope: { id: "history-preferences" },
    mutationFn: (update: (current: HistoryPreferences) => HistoryPreferences) =>
      updateSettings((current) => ({ history: update(current.history) })),
  });
  const { mutate: saveHistory } = savePreferences;
  const setFilters = useCallback(
    (next: HistoryFilters) => saveHistory((current) => ({ ...current, filters: next })),
    [saveHistory],
  );
  const toggleField = useCallback(
    (field: HistoryField) =>
      saveHistory((current) => ({
        ...current,
        fields: { ...current.fields, [field]: !current.fields[field] },
      })),
    [saveHistory],
  );
  // Settings already update optimistically; retry must not replay a toggle.
  const retrySave = useCallback(() => saveHistory((current) => current), [saveHistory]);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const filter = useMemo(
    () => ({
      projectKeys: filters.projects,
      providers: filters.providers,
      models: filters.models,
      includeArchived: filters.status !== HistoryStatus.Active,
      ...(filters.status === HistoryStatus.All
        ? {}
        : { archived: filters.status === HistoryStatus.Archived }),
    }),
    [filters.projects, filters.providers, filters.models, filters.status],
  );
  const {
    agents,
    hasMore,
    isInitialLoad,
    isLoadingMore,
    isError,
    isSearchSupported,
    isFilterSupported,
    filterOptions,
    isSearchTruncated,
    hostErrors,
    loadMore,
    refreshAll,
  } = useAgentHistory({
    serverIds: filters.hosts,
    filter,
    search,
  });
  const isSearching = isSearchSupported && search.length > 0;

  useEffect(() => {
    if (!hostsLoaded) return;
    const hostsStillPresent = filters.hosts.filter((id) =>
      hosts.some((host) => host.serverId === id),
    );
    if (hostsStillPresent.length !== filters.hosts.length) {
      setFilters({ ...filters, hosts: hostsStillPresent });
    }
  }, [hosts, hostsLoaded, filters, setFilters]);

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    void refreshAll().finally(() => setIsManualRefresh(false));
  }, [refreshAll]);

  const isFiltering = isFilterSupported ? hasHistoryFilters(filters) : filters.hosts.length > 0;
  const emptyText = isSearching || isFiltering ? t("sessions.noMatches") : t("sessions.empty");
  const showLoadError = isError && agents.length === 0;
  const showResults = !isInitialLoad && !showLoadError;

  const handleBack = useCallback(() => {
    router.navigate(buildOpenProjectRoute());
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearchInput("");
    setFilters(EMPTY_HISTORY_FILTERS);
  }, [setFilters]);

  const listFooterComponent = useMemo(() => {
    // COMPAT(historyPagination): old daemons return a truncated relevance page.
    // Added in v0.8.0; remove after 2027-03-16 once the daemon floor supports search pagination.
    if (isSearchTruncated) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerHint}>{t("sessions.tooManyMatches")}</Text>
        </View>
      );
    }
    if (!hasMore) {
      return null;
    }
    return (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
        </Button>
      </View>
    );
  }, [hasMore, isLoadingMore, isSearchTruncated, loadMore, t]);

  const filterBar = (
    <HistoryFilterBar
      filters={filters}
      options={filterOptions}
      supported={isFilterSupported}
      onChange={setFilters}
    />
  );
  const displayMenu = <HistoryDisplayMenu fields={fields} onToggle={toggleField} />;

  return (
    <View style={styles.container}>
      <MenuHeader title={t("sessions.title")} />
      <View style={styles.filterContainer}>
        <View style={styles.searchRow}>
          {isSearchSupported ? (
            <View style={styles.searchField}>
              <SearchField
                fullWidth
                value={searchInput}
                onChangeText={setSearchInput}
                placeholder={t("sessions.searchPlaceholder")}
                clearAccessibilityLabel={t("sessions.actions.clearSearch")}
                testID="sessions-search-input"
                clearTestID="sessions-search-clear"
              />
            </View>
          ) : null}
        </View>
        <View style={styles.searchRow}>
          <View style={styles.searchField}>{filterBar}</View>
          {displayMenu}
        </View>
      </View>
      <HistoryPreferencesError visible={savePreferences.isError} onRetry={retrySave} />
      {hostErrors.length > 0 ? <SessionHostErrorsBanner errors={hostErrors} t={t} /> : null}
      {isInitialLoad ? (
        <View style={styles.loadingContainer}>
          <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
        </View>
      ) : null}
      {showLoadError ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Unable to load sessions</Text>
          <Button variant="ghost" onPress={handleRefresh}>
            Try again
          </Button>
        </View>
      ) : null}
      {showResults && agents.length === 0 ? (
        <View style={styles.emptyContainer} testID="sessions-empty">
          <Text style={styles.emptyText}>{emptyText}</Text>
          {isSearching || isFiltering ? (
            <Button variant="ghost" onPress={handleClearFilters}>
              {t("sessions.filters.clear")}
            </Button>
          ) : (
            <Button variant="ghost" leftIcon={ChevronLeft} onPress={handleBack}>
              Back
            </Button>
          )}
          <Button variant="ghost" leftIcon={Import} onPress={importSession.open}>
            {t("importSession.title")}
          </Button>
        </View>
      ) : null}
      {showResults && agents.length > 0 ? (
        <AgentList
          agents={agents}
          isRefreshing={isManualRefresh}
          onRefresh={handleRefresh}
          listFooterComponent={listFooterComponent}
          showAttentionIndicator={false}
          fields={fields}
          search={isSearching ? search : undefined}
        />
      ) : null}
      {importSession.sheet}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  filterContainer: {
    gap: theme.spacing[3],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[4],
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  searchField: { flex: 1 },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
  footerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorsBannerWrap: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[3],
  },
  errorsBanner: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
