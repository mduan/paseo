import { useEffect } from "react";
import { shallow } from "zustand/shallow";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { refreshProviderSubagents, useProviderSubagentStore } from "./provider-store";

interface SubagentActivity {
  parentAgentIds: string[];
  hasRunningAgents: boolean;
}
type Agents = ReadonlyMap<string, Agent>;
type ProviderDescriptors = ReturnType<typeof useProviderSubagentStore.getState>["descriptors"];

// Tab descriptors share these indexes; unrelated stream updates reuse the source maps.
const activityCache = new WeakMap<Agents, Map<string, SubagentActivity>>();
const providerActivityCache = new WeakMap<ProviderDescriptors, Set<string>>();
const EMPTY_ACTIVITY: SubagentActivity = { parentAgentIds: [], hasRunningAgents: false };

export function selectSubagentActivity({
  agents,
  parentAgentId,
}: {
  agents: Agents | undefined;
  parentAgentId: string;
}): SubagentActivity {
  const parent = agents?.get(parentAgentId);
  if (!agents || !parent || parent.archivedAt) return EMPTY_ACTIVITY;
  let cached = activityCache.get(agents);
  if (!cached) {
    cached = new Map();
    for (const agent of agents.values()) {
      if (!agent.archivedAt) {
        cached.set(agent.id, { parentAgentIds: [agent.id], hasRunningAgents: false });
      }
    }
    for (const agent of agents.values()) {
      if (agent.archivedAt) continue;
      let current = agent;
      const seen = new Set<string>([agent.id]);
      while (current.parentAgentId) {
        const ancestor = agents.get(current.parentAgentId);
        if (!ancestor || ancestor.archivedAt || seen.has(ancestor.id)) break;
        // A child in another workspace owns its activity there, as in workspace aggregation.
        if (ancestor.workspaceId !== current.workspaceId) break;
        const activity = cached.get(ancestor.id)!;
        activity.parentAgentIds.push(agent.id);
        if (agent.status === "running") activity.hasRunningAgents = true;
        seen.add(ancestor.id);
        current = ancestor;
      }
    }
    activityCache.set(agents, cached);
  }
  return cached.get(parentAgentId)!;
}

export function hasRunningProviderSubagents({
  descriptors,
  serverId,
  parentAgentIds,
}: {
  descriptors: ProviderDescriptors;
  serverId: string;
  parentAgentIds: readonly string[];
}): boolean {
  let runningParents = providerActivityCache.get(descriptors);
  if (!runningParents) {
    runningParents = new Set();
    for (const [key, subagent] of descriptors) {
      if (subagent.status === "running") {
        runningParents.add(key.slice(0, key.lastIndexOf("\0")));
      }
    }
    providerActivityCache.set(descriptors, runningParents);
  }
  return parentAgentIds.some((id) => runningParents.has(`${serverId}\0${id}`));
}

export function useHasRunningSubagents(params: { serverId: string; parentAgentId: string }) {
  const parentAgentIds = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      selectSubagentActivity({
        agents: state.sessions[params.serverId]?.agents,
        parentAgentId: params.parentAgentId,
      }).parentAgentIds,
    shallow,
  );
  const supported = useSessionStore(
    (state) => state.sessions[params.serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const client = useSessionStore((state) => state.sessions[params.serverId]?.client);
  const connected = useHostRuntimeIsConnected(params.serverId);
  const hasRunningAgents = useSessionStore(
    (state) =>
      selectSubagentActivity({
        agents: state.sessions[params.serverId]?.agents,
        parentAgentId: params.parentAgentId,
      }).hasRunningAgents,
  );
  const hasRunningProviderChildren = useProviderSubagentStore(
    (state) =>
      supported &&
      hasRunningProviderSubagents({
        descriptors: state.descriptors,
        serverId: params.serverId,
        parentAgentIds,
      }),
  );

  useEffect(() => {
    if (!client || !supported || !connected) return;
    for (const parentAgentId of parentAgentIds) {
      void refreshProviderSubagents(client, params.serverId, parentAgentId).catch(() => undefined);
    }
  }, [client, supported, connected, params.serverId, parentAgentIds]);

  return hasRunningAgents || hasRunningProviderChildren;
}
