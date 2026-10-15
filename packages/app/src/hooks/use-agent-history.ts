import type { SearchOptions } from "@getpaseo/protocol/search/options";
import type { AgentHistoryFilterOptions } from "@getpaseo/protocol/messages";
import type {
  DaemonClient,
  FetchAgentHistoryOptions,
  FetchAgentHistoryPageInfo,
} from "@getpaseo/client/internal/daemon-client";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { buildAgentDirectoryState } from "@/utils/agent-directory-sync";
import { agentHistoryQueryKey, allAgentHistoryQueryKey } from "./agent-history-query-key";

const AGENT_HISTORY_PAGE_LIMIT = 200;
const AGENT_HISTORY_SORT: NonNullable<FetchAgentHistoryOptions["sort"]> = [
  { key: "updated_at", direction: "desc" },
];
const AGENT_HISTORY_ALL_HOSTS_FAILED_MESSAGE = "No connected hosts could load agent history";

export interface AgentHistoryResult {
  agents: AggregatedAgent[];
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  /** False when any target host predates search; the screen hides the field. */
  isSearchSupported: boolean;
  isSearchOptionsSupported: boolean;
  isSearchPaused: boolean;
  isFilterSupported: boolean;
  isAgentTypeFilterSupported: boolean;
  filterOptions: AgentHistoryFilterOptions;
  /** More sessions matched than the ranked page holds. Narrow the query. */
  isSearchTruncated: boolean;
  /** Hosts that failed while others succeeded. The list still renders. */
  hostErrors: AgentHistoryHostError[];
  refreshAll: () => Promise<void>;
  loadMore: () => void;
}

export interface AgentHistoryPage {
  agents: AggregatedAgent[];
  pageInfo: FetchAgentHistoryPageInfo;
  filterOptions?: AgentHistoryFilterOptions;
  /** More matched this host's query than its page could hold. */
  isSearchTruncated: boolean;
}

export type AgentHistoryClient = Pick<DaemonClient, "fetchAgentHistory">;

/**
 * A host that could not be reached while at least one other could. Its sessions
 * are missing from the list, which under a query means "no matches" would be a
 * claim the app cannot make.
 */
export interface AgentHistoryHostError {
  serverId: string;
  serverName: string;
}

export interface AgentHistoryHost {
  serverId: string;
  serverLabel: string;
  client: AgentHistoryClient;
}

interface AgentHistoryBatchPage {
  agents: AggregatedAgent[];
  pageInfoByServerId: Record<string, FetchAgentHistoryPageInfo>;
  filterOptions?: AgentHistoryFilterOptions;
  hostErrors: AgentHistoryHostError[];
  /** Set only under a query: more sessions matched than this page can hold. */
  isSearchTruncated?: boolean;
}

type AgentHistoryCursorByServerId = Record<string, string | null>;

export async function fetchAgentHistoryPage(input: {
  client: AgentHistoryClient;
  serverId: string;
  cursor: string | null;
  search?: string;
  searchOptions?: SearchOptions;
  filter?: FetchAgentHistoryOptions["filter"];
  includeFilterOptions?: boolean;
}): Promise<AgentHistoryPage> {
  const payload = await input.client.fetchAgentHistory({
    ...(input.search ? { search: input.search } : {}),
    ...(input.searchOptions ? { searchOptions: input.searchOptions } : {}),
    ...(input.filter ? { filter: input.filter } : {}),
    ...(input.includeFilterOptions ? { includeFilterOptions: true } : {}),
    sort: AGENT_HISTORY_SORT,
    page: input.cursor
      ? { limit: AGENT_HISTORY_PAGE_LIMIT, cursor: input.cursor }
      : { limit: AGENT_HISTORY_PAGE_LIMIT },
  });

  const { agents } = buildAgentDirectoryState({
    serverId: input.serverId,
    entries: payload.entries,
  });
  const thinkingOptions = new Map(
    payload.entries.map(({ agent }) => [
      agent.id,
      agent.effectiveThinkingOptionId ??
        agent.runtimeInfo?.thinkingOptionId ??
        agent.thinkingOptionId,
    ]),
  );
  return {
    filterOptions: payload.filterOptions,
    isSearchTruncated: payload.searchTruncated === true,
    agents: Array.from(agents.values(), (agent) => ({
      id: agent.id,
      serverId: input.serverId,
      serverLabel: input.serverId,
      title: agent.title ?? null,
      status: agent.status,
      turn: agent.turn,
      turnCount: agent.turnCount,
      lastActivityAt: agent.lastActivityAt,
      cwd: agent.cwd,
      workspaceId: agent.workspaceId,
      provider: agent.provider,
      model: agent.runtimeInfo?.model ?? agent.model,
      thinkingOptionId: thinkingOptions.get(agent.id),
      lastUsage: agent.lastUsage,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
      attentionTimestamp: agent.attentionTimestamp ?? null,
      archivedAt: agent.archivedAt ?? null,
      createdAt: agent.createdAt,
      labels: agent.labels,
      projectPlacement: agent.projectPlacement,
    })),
    pageInfo: payload.pageInfo,
  };
}

function sortByLatestActivity(agents: AggregatedAgent[]): AggregatedAgent[] {
  return [...agents].sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
}

/**
 * Which hosts are missing from the list the user is looking at.
 *
 * Failures are collected across every loaded page, not just the newest: a host
 * that rejects page one contributes no cursor and is never asked again, so a
 * later page carries no error of its own while that host's history is still
 * absent. A refetch replaces every page, which is what clears an error that has
 * healed.
 */
export function collectAgentHistoryHostErrors(input: {
  pages: readonly Pick<AgentHistoryBatchPage, "hostErrors">[];
  unreachableHosts: readonly AgentHistoryHostError[];
}): AgentHistoryHostError[] {
  const byServerId = new Map<string, AgentHistoryHostError>();
  for (const error of input.unreachableHosts) {
    byServerId.set(error.serverId, error);
  }
  for (const page of input.pages) {
    for (const error of page.hostErrors) {
      byServerId.set(error.serverId, error);
    }
  }
  return [...byServerId.values()];
}

function getNextAgentHistoryPageParam(
  page: AgentHistoryBatchPage,
): AgentHistoryCursorByServerId | null {
  const cursorByServerId: AgentHistoryCursorByServerId = {};
  for (const [serverId, pageInfo] of Object.entries(page.pageInfoByServerId)) {
    if (pageInfo.hasMore && pageInfo.nextCursor) {
      cursorByServerId[serverId] = pageInfo.nextCursor;
    }
  }

  return Object.keys(cursorByServerId).length > 0 ? cursorByServerId : null;
}

export async function fetchAgentHistoryBatch(input: {
  hosts: readonly AgentHistoryHost[];
  cursorByServerId: AgentHistoryCursorByServerId | null;
  search?: string;
  searchOptions?: SearchOptions;
  filter?: FetchAgentHistoryOptions["filter"];
  includeFilterOptions?: boolean;
}): Promise<AgentHistoryBatchPage> {
  const cursorByServerId = input.cursorByServerId ?? {};
  const hasCursorFilter = Object.keys(cursorByServerId).length > 0;
  const hostsToFetch = hasCursorFilter
    ? input.hosts.filter((host) => Object.hasOwn(cursorByServerId, host.serverId))
    : input.hosts;

  const settledPages = await Promise.allSettled(
    hostsToFetch.map(async (host) => {
      const page = await fetchAgentHistoryPage({
        client: host.client,
        serverId: host.serverId,
        cursor: cursorByServerId[host.serverId] ?? null,
        filter: input.filter,
        includeFilterOptions: input.includeFilterOptions && !input.cursorByServerId,
        ...(input.search ? { search: input.search } : {}),
        ...(input.searchOptions ? { searchOptions: input.searchOptions } : {}),
      });
      return { host, page };
    }),
  );
  const pages = settledPages.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (pages.length === 0) {
    throw new Error(AGENT_HISTORY_ALL_HOSTS_FAILED_MESSAGE);
  }
  // allSettled preserves order, so a rejection still names the host it came
  // from. Losing that name is what would let the list quietly under-report.
  const hostErrors = settledPages.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            serverId: hostsToFetch[index].serverId,
            serverName: hostsToFetch[index].serverLabel,
          },
        ]
      : [],
  );

  const agents = pages.flatMap(({ host, page }) =>
    page.agents.map((agent) => Object.assign({}, agent, { serverLabel: host.serverLabel })),
  );
  const pageInfoByServerId = Object.fromEntries(
    pages.map(({ host, page }) => [host.serverId, page.pageInfo]),
  );
  return {
    filterOptions: {
      projects: pages.flatMap(({ page }) => page.filterOptions?.projects ?? []),
      models: pages.flatMap(({ page }) => page.filterOptions?.models ?? []),
    },
    agents: sortByLatestActivity(agents),
    pageInfoByServerId,
    hostErrors,
    ...(input.search
      ? { isSearchTruncated: pages.some(({ page }) => page.isSearchTruncated) }
      : {}),
  };
}

export function useAgentHistory(options: {
  serverIds?: readonly string[];
  enabled?: boolean;
  search?: string;
  searchOptions?: SearchOptions;
  filter?: FetchAgentHistoryOptions["filter"];
}): AgentHistoryResult {
  const { t } = useTranslation();
  const daemons = useHosts();
  const runtime = getHostRuntimeStore();
  const requestedServerIds = useMemo(
    () =>
      options.serverIds?.length ? options.serverIds : daemons.map((daemon) => daemon.serverId),
    [options.serverIds, daemons],
  );
  const connectionStatuses = useHostRuntimeConnectionStatuses(requestedServerIds);
  const enabled = options.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const releases = requestedServerIds.map((serverId) => runtime.acquireDirectoryDemand(serverId));
    return () => releases.forEach((release) => release());
  }, [enabled, requestedServerIds, runtime]);
  const liveAgentsByServer = useSessionStore(
    useShallow((state) => {
      const agents: Record<string, Map<string, Agent> | undefined> = {};
      for (const serverId of requestedServerIds)
        agents[serverId] = state.sessions[serverId]?.agents;
      return agents;
    }),
  );
  // A host the user asked about splits two ways: one this fetch can reach, and
  // one whose sessions will be missing from the answer. Both come out of here,
  // because dropping the unreachable ones silently is what lets the list — and
  // worse, "No sessions match" — overstate what was actually searched.
  const { targetHosts, unreachableHosts } = useMemo(() => {
    const serverLabelById = new Map(daemons.map((daemon) => [daemon.serverId, daemon.label]));
    const hosts: AgentHistoryHost[] = [];
    const unreachable: AgentHistoryHostError[] = [];

    for (const targetServerId of requestedServerIds) {
      const client = runtime.getClient(targetServerId);
      const serverName = serverLabelById.get(targetServerId) ?? targetServerId;
      if (!client || connectionStatuses.get(targetServerId) !== "online") {
        unreachable.push({ serverId: targetServerId, serverName });
        continue;
      }
      hosts.push({ serverId: targetServerId, serverLabel: serverName, client });
    }

    return { targetHosts: hosts, unreachableHosts: unreachable };
  }, [daemons, runtime, connectionStatuses, requestedServerIds]);
  const targetServerIds = useMemo(() => targetHosts.map((host) => host.serverId), [targetHosts]);
  // One gate, checked before the field is offered: a fleet where any host
  // predates search has no search, rather than a list that silently omits that
  // host's sessions.
  const isSearchSupported = useSessionStore(
    useCallback(
      (state) =>
        targetServerIds.length > 0 &&
        targetServerIds.every(
          (id) => state.sessions[id]?.serverInfo?.features?.agentHistorySearch === true,
        ),
      [targetServerIds],
    ),
  );
  // COMPAT(agentHistoryFilters): added in v0.11.0-fork.15, remove gate after 2027-04-14.
  const isFilterSupported = useSessionStore(
    useCallback(
      (state) =>
        targetServerIds.length > 0 &&
        targetServerIds.every(
          (id) => state.sessions[id]?.serverInfo?.features?.agentHistoryFilters === true,
        ),
      [targetServerIds],
    ),
  );
  // COMPAT(agentHistoryAgentTypeFilter): added in v0.11.0-fork.17, remove gate after 2027-04-15.
  const isAgentTypeFilterSupported = useSessionStore(
    useCallback(
      (state) =>
        targetServerIds.length > 0 &&
        targetServerIds.every(
          (id) => state.sessions[id]?.serverInfo?.features?.agentHistoryAgentTypeFilter === true,
        ),
      [targetServerIds],
    ),
  );
  // COMPAT(agentHistorySearchOptions): added in v0.11.0-fork.19, remove gate after 2027-04-15.
  const isSearchOptionsSupported = useSessionStore(
    useCallback(
      (state) =>
        targetServerIds.length > 0 &&
        targetServerIds.every(
          (id) => state.sessions[id]?.serverInfo?.features?.agentHistorySearchOptions === true,
        ),
      [targetServerIds],
    ),
  );
  const hasSearchOptions = Object.values(options.searchOptions ?? {}).some(Boolean);
  const canSearch = !hasSearchOptions || isSearchOptionsSupported;
  const filter = useMemo(() => {
    if (!isFilterSupported || !options.filter) return undefined;
    return {
      ...options.filter,
      isSubagent: isAgentTypeFilterSupported ? options.filter.isSubagent : undefined,
    };
  }, [isFilterSupported, isAgentTypeFilterSupported, options.filter]);
  const search = useMemo(() => {
    const trimmed = options.searchOptions?.regex
      ? (options.search ?? "")
      : (options.search?.trim() ?? "");
    return isSearchSupported ? trimmed : "";
  }, [isSearchSupported, options.search, options.searchOptions?.regex]);
  const queryKey = useMemo(
    () => [
      ...(targetServerIds.length === 1
        ? agentHistoryQueryKey(targetServerIds[0])
        : allAgentHistoryQueryKey(targetServerIds)),
      search,
      options.searchOptions,
      canSearch,
      filter,
      isFilterSupported,
    ],
    [search, options.searchOptions, canSearch, filter, isFilterSupported, targetServerIds],
  );
  const serverLabelById = useMemo(
    () => new Map(daemons.map((daemon) => [daemon.serverId, daemon.label])),
    [daemons],
  );

  const historyQuery = useInfiniteQuery<
    AgentHistoryBatchPage,
    Error,
    { pages: AgentHistoryBatchPage[] },
    readonly unknown[],
    AgentHistoryCursorByServerId | null
  >({
    queryKey,
    enabled: Boolean(enabled && canSearch && targetHosts.length > 0),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    initialPageParam: null,
    getNextPageParam: getNextAgentHistoryPageParam,
    queryFn: async ({ pageParam }) => {
      if (targetHosts.length === 0) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return fetchAgentHistoryBatch({
        hosts: targetHosts,
        cursorByServerId: pageParam,
        filter,
        includeFilterOptions: isFilterSupported,
        ...(search ? { search } : {}),
        ...(hasSearchOptions ? { searchOptions: options.searchOptions } : {}),
      });
    },
  });
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetching,
    isFetchingNextPage,
    isLoading,
    isPlaceholderData,
    refetch,
  } = historyQuery;

  const refreshAll = useCallback(async () => {
    if (!enabled || !canSearch || targetHosts.length === 0) {
      return;
    }
    await refetch();
  }, [enabled, canSearch, refetch, targetHosts.length]);

  const loadMore = useCallback(() => {
    if (!enabled || !canSearch || targetHosts.length === 0 || !hasNextPage || isFetchingNextPage) {
      return;
    }
    void fetchNextPage();
  }, [enabled, canSearch, fetchNextPage, hasNextPage, isFetchingNextPage, targetHosts.length]);

  const agents = useMemo(() => {
    const pages = data?.pages ?? [];
    const historyAgents = pages.flatMap((page) => page.agents);
    const labelledAgents = historyAgents.map((agent) => {
      const live = liveAgentsByServer[agent.serverId]?.get(agent.id);
      const current = Object.assign({}, agent, {
        serverLabel: serverLabelById.get(agent.serverId) ?? agent.serverLabel,
      });
      if (live) {
        Object.assign(current, {
          status: live.status,
          turn: live.turn,
          turnCount: live.turnCount ?? agent.turnCount,
          requiresAttention: live.requiresAttention,
          attentionReason: live.attentionReason,
          pendingPermissionCount: live.pendingPermissions.length,
        });
      }
      return current;
    });
    return sortByLatestActivity(labelledAgents);
  }, [data?.pages, serverLabelById, liveAgentsByServer]);
  const filterOptions = useMemo<AgentHistoryFilterOptions>(
    () => ({
      projects: data?.pages.flatMap((page) => page.filterOptions?.projects ?? []) ?? [],
      models: data?.pages.flatMap((page) => page.filterOptions?.models ?? []) ?? [],
    }),
    [data?.pages],
  );
  const isInitialLoad = isPlaceholderData || (isLoading && agents.length === 0);
  const isRevalidating = isFetching && !isFetchingNextPage && agents.length > 0;
  const isSearchTruncated = Boolean(search && data?.pages.some((page) => page.isSearchTruncated));
  const hostErrors = useMemo(
    () => collectAgentHistoryHostErrors({ pages: data?.pages ?? [], unreachableHosts }),
    [data?.pages, unreachableHosts],
  );

  return {
    agents,
    isLoading,
    isInitialLoad,
    isRevalidating,
    isError,
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    isSearchSupported,
    isSearchOptionsSupported,
    isSearchPaused: !enabled || !canSearch,
    isFilterSupported,
    isAgentTypeFilterSupported,
    filterOptions,
    isSearchTruncated,
    hostErrors,
    refreshAll,
    loadMore,
  };
}
