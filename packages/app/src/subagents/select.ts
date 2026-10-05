import { useEffect, useMemo } from "react";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { usePendingArchiveAgentIds } from "@/hooks/use-archive-agent";
import equal from "fast-deep-equal";
import { useShallow } from "zustand/react/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { refreshProviderSubagents, useProviderSubagentStore } from "./provider-store";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";

export interface PaseoSubagentRow {
  kind: "paseo";
  id: Agent["id"];
  provider: Agent["provider"];
  title: Agent["title"];
  /** Managed agents have a real title, so the union's task line is always absent for them. */
  description: null;
  subtitle: null;
  status: Agent["status"];
  turn: Agent["turn"];
  requiresAttention: Agent["requiresAttention"];
  createdAt: Agent["createdAt"];
}

export interface ProviderSubagentRow {
  kind: "provider";
  id: string;
  parentAgentId: string;
  provider: ProviderSubagentDescriptorPayload["provider"];
  // `title` is the subagent type ("Explore", "general-purpose") and repeats across a fan-out;
  // `description` is the task it was given. Both are carried so presentation can choose which
  // one names the row — collapsing them here is what makes every row read alike.
  title: string | null;
  description: string | null;
  /** Compact provider-owned context. The app displays it without interpreting its contents. */
  subtitle: string | null;
  status: ProviderSubagentDescriptorPayload["status"];
  requiresAttention: boolean;
  createdAt: Date;
}

export type SubagentRow = PaseoSubagentRow | ProviderSubagentRow;

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;
type ProviderSubagentStoreSnapshot = ReturnType<typeof useProviderSubagentStore.getState>;

interface SelectSubagentsParams {
  serverId: string;
  parentAgentId: string;
  /** Select children of this provider subagent instead of children of the managed agent. */
  providerParentSubagentId?: string;
  includeDescendants?: boolean;
}

const providerRowsCache = new WeakMap<
  ProviderSubagentStoreSnapshot["descriptors"],
  WeakMap<ReadonlySet<string>, Map<string, ProviderSubagentRow[]>>
>();
const managedRowsCache = new WeakMap<ReadonlyMap<string, Agent>, Map<string, SubagentRow[]>>();

const EMPTY_SUBAGENT_ROWS: SubagentRow[] = [];
const EMPTY_PROVIDER_SUBAGENT_ROWS: ProviderSubagentRow[] = [];

function toSubagentRow(agent: Agent): SubagentRow {
  return {
    kind: "paseo",
    id: agent.id,
    provider: agent.provider,
    title: agent.title,
    description: null,
    subtitle: null,
    status: agent.status,
    turn: agent.turn,
    requiresAttention: agent.requiresAttention,
    createdAt: agent.createdAt,
  };
}

function isDescendantInWorkspace({
  agent,
  agents,
  parentAgentId,
}: {
  agent: Agent;
  agents: ReadonlyMap<string, Agent>;
  parentAgentId: string;
}): boolean {
  const seen = new Set([agent.id]);
  let current = agent;
  while (current.parentAgentId) {
    const parent = agents.get(current.parentAgentId);
    if (
      !parent ||
      parent.archivedAt ||
      parent.workspaceId !== agent.workspaceId ||
      seen.has(parent.id)
    )
      return false;
    if (parent.id === parentAgentId) return true;
    seen.add(parent.id);
    current = parent;
  }
  return false;
}

export function selectSubagentsForParent(
  state: SessionStoreSnapshot,
  params: SelectSubagentsParams,
  pendingArchiveIds: ReadonlySet<string>,
): SubagentRow[] {
  const agents = state.sessions[params.serverId]?.agents;
  if (!agents || agents.size === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  let cache = managedRowsCache.get(agents);
  if (!cache) {
    cache = new Map();
    managedRowsCache.set(agents, cache);
  }
  const key = `${params.parentAgentId}\0${Boolean(params.includeDescendants)}`;
  let rows = cache.get(key);
  if (!rows) {
    rows = [];
    for (const agent of agents.values()) {
      if (agent.archivedAt) continue;
      const belongsToParent = params.includeDescendants
        ? isDescendantInWorkspace({ agent, agents, parentAgentId: params.parentAgentId })
        : agent.parentAgentId === params.parentAgentId;
      if (belongsToParent) rows.push(toSubagentRow(agent));
    }
    rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    cache.set(key, rows);
  }
  const visibleRows = pendingArchiveIds.size
    ? rows.filter((row) => !pendingArchiveIds.has(row.id))
    : rows;
  return visibleRows.length ? visibleRows : EMPTY_SUBAGENT_ROWS;
}

export function selectProviderSubagentsForParent(
  state: ProviderSubagentStoreSnapshot,
  params: SelectSubagentsParams,
  supported: boolean,
  nestingSupported = false,
): ProviderSubagentRow[] {
  if (!supported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  if (params.providerParentSubagentId && !nestingSupported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  let hiddenCache = providerRowsCache.get(state.descriptors);
  if (!hiddenCache) {
    hiddenCache = new WeakMap();
    providerRowsCache.set(state.descriptors, hiddenCache);
  }
  let cache = hiddenCache.get(state.hiddenFromTrack);
  if (!cache) {
    cache = new Map();
    hiddenCache.set(state.hiddenFromTrack, cache);
  }
  const cacheKey = `${params.serverId}\0${params.parentAgentId}\0${nestingSupported}\0${params.providerParentSubagentId ?? ""}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const rows: ProviderSubagentRow[] = [];
  const prefix = `${params.serverId}\0${params.parentAgentId}\0`;
  for (const [key, subagent] of state.descriptors) {
    if (!key.startsWith(prefix) || state.hiddenFromTrack.has(key)) continue;
    if (
      nestingSupported &&
      (subagent.parentSubagentId ?? null) !== (params.providerParentSubagentId ?? null)
    ) {
      continue;
    }
    rows.push({
      kind: "provider",
      id: subagent.id,
      parentAgentId: subagent.parentAgentId,
      provider: subagent.provider,
      title: subagent.title,
      description: subagent.description,
      subtitle: subagent.subtitle ?? null,
      status: subagent.status,
      requiresAttention: subagent.status === "failed",
      createdAt: new Date(subagent.createdAt),
    });
  }
  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  cache.set(cacheKey, rows);
  return rows;
}

export function useSubagentsForParent(params: SelectSubagentsParams): SubagentRow[] {
  const pendingArchiveIds = usePendingArchiveAgentIds(params.serverId);
  const paseoRows = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectSubagentsForParent(state, params, pendingArchiveIds),
    equal,
  );
  const supported = useSessionStore(
    (state) => state.sessions[params.serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const nestingSupported = useSessionStore(
    (state) =>
      state.sessions[params.serverId]?.serverInfo?.features?.providerSubagentNesting === true,
  );
  const includeParent = useSessionStore((state) => {
    if (!params.includeDescendants) return true;
    const parent = state.sessions[params.serverId]?.agents.get(params.parentAgentId);
    return Boolean(parent && !parent.archivedAt);
  });
  const selectParentAgentIds = useShallow((rows: SubagentRow[]) => {
    if (!includeParent) return [];
    const ids = [params.parentAgentId];
    if (params.includeDescendants) ids.push(...rows.map((row) => row.id));
    return ids;
  });
  const parentAgentIds = selectParentAgentIds(paseoRows);
  const providerRows = useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) =>
      parentAgentIds.flatMap((parentAgentId) =>
        selectProviderSubagentsForParent(
          state,
          { ...params, parentAgentId },
          supported,
          nestingSupported && !params.includeDescendants,
        ),
      ),
    equal,
  );
  const client = useSessionStore((state) => state.sessions[params.serverId]?.client ?? null);

  const connected = useHostRuntimeIsConnected(params.serverId);
  useEffect(() => {
    if (!client || !supported || !connected) return;
    for (const parentAgentId of parentAgentIds) {
      void refreshProviderSubagents(client, params.serverId, parentAgentId).catch(() => undefined);
    }
  }, [client, parentAgentIds, params.serverId, supported, connected]);

  return useMemo(() => {
    if (params.providerParentSubagentId) return providerRows;
    if (providerRows.length === 0) return paseoRows;
    const rows = [...paseoRows, ...providerRows];
    rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    return rows;
  }, [params.providerParentSubagentId, paseoRows, providerRows]);
}
