import { useMemo, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import equal from "fast-deep-equal";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import type { Agent } from "@/stores/session-store";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";

export interface AggregatedAgent extends AgentDirectoryEntry {
  serverId: string;
  serverLabel: string;
  workspaceLinearIssues?: import("@getpaseo/protocol/messages").LinearIssue[];
  workspacePullRequest?: import("@/git/pr-hint").PrHint | null;
}

const DISABLED_RESULT = {
  agents: [] as AggregatedAgent[],
  isLoading: false,
  isInitialLoad: false,
  isRevalidating: false,
};

export interface AggregatedAgentsResult {
  agents: AggregatedAgent[];
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  refreshAll: () => void;
}

export type SessionAgentMaps = Record<string, Map<string, Agent> | undefined>;

const NO_SESSION_AGENTS: SessionAgentMaps = {};

/** Each session's agents map, keyed by server id. Stable while no session's agents map changes. */
export function useSessionAgentMaps(enabled = true): SessionAgentMaps {
  return useSessionStore(
    useShallow((state) => {
      if (!enabled) return NO_SESSION_AGENTS;
      const result: SessionAgentMaps = {};
      for (const [serverId, session] of Object.entries(state.sessions)) {
        result[serverId] = session.agents;
      }
      return result;
    }),
  );
}

/** Holds agent directory demand on every host while `enabled`. */
export function useAgentDirectoryDemand(enabled: boolean): void {
  const daemons = useHosts();
  const runtime = getHostRuntimeStore();
  const serverIds = useMemo(() => daemons.map((daemon) => daemon.serverId), [daemons]);
  useEffect(() => {
    if (!enabled) return;
    const releases = serverIds.map((serverId) => runtime.acquireDirectoryDemand(serverId));
    return () => releases.forEach((release) => release());
  }, [enabled, runtime, serverIds]);
}

/** Unsorted, freshly built entries for every session agent. */
export function buildAggregatedAgents({
  sessionAgents,
  serverLabelById,
  includeArchived,
}: {
  sessionAgents: SessionAgentMaps;
  serverLabelById: ReadonlyMap<string, string>;
  includeArchived: boolean;
}): AggregatedAgent[] {
  const allAgents: AggregatedAgent[] = [];
  for (const [serverId, agents] of Object.entries(sessionAgents)) {
    if (!agents || agents.size === 0) {
      continue;
    }
    const serverLabel = serverLabelById.get(serverId) ?? serverId;
    for (const agent of agents.values()) {
      if (!includeArchived && agent.archivedAt) {
        continue;
      }
      allAgents.push({
        id: agent.id,
        serverId,
        serverLabel,
        title: agent.title ?? null,
        status: agent.status,
        turn: agent.turn,
        lastActivityAt: agent.lastActivityAt,
        cwd: agent.cwd,
        workspaceId: agent.workspaceId,
        provider: agent.provider,
        pendingPermissionCount: agent.pendingPermissions.length,
        requiresAttention: agent.requiresAttention,
        attentionReason: agent.attentionReason,
        attentionTimestamp: agent.attentionTimestamp,
        archivedAt: agent.archivedAt,
        createdAt: agent.createdAt,
        labels: agent.labels,
        projectPlacement: agent.projectPlacement,
      });
    }
  }
  return allAgents;
}

const noopSubscribe = () => () => {};

/**
 * `enabled: false` skips aggregation and runtime subscriptions and returns no agents, so an
 * always-mounted caller costs nothing until it needs the list.
 */
export function useAggregatedAgents(options?: {
  includeArchived?: boolean;
  enabled?: boolean;
}): AggregatedAgentsResult {
  const daemons = useHosts();
  const runtime = getHostRuntimeStore();
  const includeArchived = options?.includeArchived ?? false;
  const enabled = options?.enabled ?? true;
  const serverIds = useMemo(() => daemons.map((daemon) => daemon.serverId), [daemons]);
  useAgentDirectoryDemand(enabled);
  const runtimeVersion = useSyncExternalStore(
    enabled ? (onStoreChange) => runtime.subscribeAll(onStoreChange) : noopSubscribe,
    () => (enabled ? runtime.getVersion() : 0),
    () => (enabled ? runtime.getVersion() : 0),
  );

  const sessionAgents = useSessionAgentMaps(enabled);

  const refreshAll = useCallback(() => {
    if (!enabled) return;
    for (const serverId of serverIds) void runtime.refreshDirectories(serverId);
  }, [enabled, runtime, serverIds]);

  // Keyed by "serverId:agentId" — reuse the previous AggregatedAgent object when
  // none of its fields changed, so downstream memo/shallow comparisons can bail early.
  const prevAgentsRef = useRef<Map<string, AggregatedAgent>>(new Map());
  // Preserved sorted array — returned as-is when every element kept its identity
  // and order, so callers using reference equality skip re-renders entirely.
  const prevSortedRef = useRef<AggregatedAgent[]>([]);

  const result = useMemo(() => {
    if (!enabled) return DISABLED_RESULT;
    // runtimeVersion is referenced so the memo recomputes when runtime state changes.
    void runtimeVersion;
    const serverLabelById = new Map(
      daemons.map((daemon) => [daemon.serverId, daemon.label] as const),
    );
    const allAgents = buildAggregatedAgents({
      sessionAgents,
      serverLabelById,
      includeArchived,
    }).map((nextAgent) => {
      const prev = prevAgentsRef.current.get(`${nextAgent.serverId}:${nextAgent.id}`);
      // Preserve object identity when fields are unchanged so callers can use
      // reference equality (useShallow, memo) to skip re-renders.
      return prev !== undefined && equal(prev, nextAgent) ? prev : nextAgent;
    });
    // Sort by: running agents first, then by most recent activity
    allAgents.sort((left, right) => {
      const leftRunning = left.turn.phase === "open";
      const rightRunning = right.turn.phase === "open";
      if (leftRunning && !rightRunning) {
        return -1;
      }
      if (!leftRunning && rightRunning) {
        return 1;
      }
      const leftTime = left.lastActivityAt.getTime();
      const rightTime = right.lastActivityAt.getTime();
      return rightTime - leftTime;
    });

    // Update the identity cache for the next render pass.
    const nextCache = new Map<string, AggregatedAgent>();
    for (const agent of allAgents) {
      nextCache.set(`${agent.serverId}:${agent.id}`, agent);
    }
    prevAgentsRef.current = nextCache;

    // If every element kept its reference identity and the order is the same,
    // return the previous array so downstream reference comparisons can bail.
    const prevSorted = prevSortedRef.current;
    const stableAgents =
      allAgents.length === prevSorted.length &&
      allAgents.every((agent, i) => agent === prevSorted[i])
        ? prevSorted
        : allAgents;
    prevSortedRef.current = stableAgents;

    // Check if we have any cached data
    const hasAnyData = stableAgents.length > 0;

    // Align list loading with the runtime directory-sync machine.
    const isLoading = daemons.some((daemon) => {
      const status =
        runtime.getSnapshot(daemon.serverId)?.agentDirectoryStatus ?? "initial_loading";
      return status === "initial_loading" || status === "revalidating";
    });
    const isInitialLoad = isLoading && !hasAnyData;
    const isRevalidating = isLoading && hasAnyData;

    return {
      agents: stableAgents,
      isLoading,
      isInitialLoad,
      isRevalidating,
    };
  }, [daemons, enabled, includeArchived, runtime, runtimeVersion, sessionAgents]);

  return {
    ...result,
    refreshAll,
  };
}
