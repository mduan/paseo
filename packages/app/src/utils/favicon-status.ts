import type { SessionAgentMaps } from "@/hooks/use-aggregated-agents";
import type { AgentDirectoryEntry } from "@/types/agent-directory";

export type FaviconStatus = "none" | "running" | "attention";

type FaviconStatusAgent = Pick<
  AgentDirectoryEntry,
  "status" | "requiresAttention" | "pendingPermissionCount"
>;

export function deriveFaviconStatus(agents: Iterable<FaviconStatusAgent>): FaviconStatus {
  let hasAttention = false;
  for (const agent of agents) {
    if (agent.status === "running") {
      return "running";
    }
    if (agent.requiresAttention || (agent.pendingPermissionCount ?? 0) > 0) {
      hasAttention = true;
    }
  }
  return hasAttention ? "attention" : "none";
}

function* unarchivedSessionAgents(sessionAgents: SessionAgentMaps): Generator<FaviconStatusAgent> {
  for (const agents of Object.values(sessionAgents)) {
    if (!agents) continue;
    for (const agent of agents.values()) {
      if (agent.archivedAt) continue;
      yield {
        status: agent.status,
        requiresAttention: agent.requiresAttention,
        pendingPermissionCount: agent.pendingPermissions.length,
      };
    }
  }
}

/** Same status as `deriveFaviconStatus` over the aggregated agent list, without building it. */
export function deriveFaviconStatusFromSessionAgents(
  sessionAgents: SessionAgentMaps,
): FaviconStatus {
  return deriveFaviconStatus(unarchivedSessionAgents(sessionAgents));
}
