import { AGENT_LIFECYCLE_STATUSES } from "@getpaseo/protocol/agent-lifecycle";
import { describe, expect, it } from "vitest";
import {
  buildAggregatedAgents,
  type AggregatedAgent,
  type SessionAgentMaps,
} from "@/hooks/use-aggregated-agents";
import type { Agent } from "@/stores/session-store";
import { deriveFaviconStatusFromSessionAgents, type FaviconStatus } from "./favicon-status";

// The favicon status as derived before it read session agents directly.
function deriveStatusFromAggregatedAgents(agents: AggregatedAgent[]): FaviconStatus {
  const hasRunning = agents.some((agent) => agent.status === "running");
  if (hasRunning) {
    return "running";
  }
  const hasAttention = agents.some((agent) => agent.requiresAttention);
  const hasNeedsInput = agents.some((agent) => (agent.pendingPermissionCount ?? 0) > 0);
  if (hasAttention || hasNeedsInput) {
    return "attention";
  }
  return "none";
}

type AgentState = Pick<Agent, "status" | "requiresAttention" | "archivedAt"> & {
  pendingPermissionCount: number;
};

function makeAgent(id: string, state: AgentState): Agent {
  const now = new Date("2026-04-01T03:00:00.000Z");
  return {
    serverId: "server-a",
    id,
    provider: "codex",
    status: state.status,
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: now,
    updatedAt: now,
    lastUserMessageAt: null,
    lastActivityAt: now,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: Array.from({
      length: state.pendingPermissionCount,
    }) as Agent["pendingPermissions"],
    persistence: null,
    title: id,
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    labels: {},
    requiresAttention: state.requiresAttention,
    archivedAt: state.archivedAt,
  };
}

const AGENT_STATES: AgentState[] = [];
for (const status of AGENT_LIFECYCLE_STATUSES) {
  for (const requiresAttention of [undefined, false, true]) {
    for (const pendingPermissionCount of [0, 2]) {
      for (const archivedAt of [null, undefined, new Date("2026-04-02T00:00:00.000Z")]) {
        AGENT_STATES.push({ status, requiresAttention, pendingPermissionCount, archivedAt });
      }
    }
  }
}

function expectSameStatus(sessionAgents: SessionAgentMaps): void {
  const aggregated = buildAggregatedAgents({
    sessionAgents,
    serverLabelById: new Map(),
    includeArchived: false,
  });
  expect(deriveFaviconStatusFromSessionAgents(sessionAgents)).toBe(
    deriveStatusFromAggregatedAgents(aggregated),
  );
}

describe("deriveFaviconStatusFromSessionAgents", () => {
  it("matches the aggregated-agents status with no agents", () => {
    expectSameStatus({});
    expectSameStatus({ "server-a": undefined, "server-b": new Map() });
  });

  it("matches the aggregated-agents status for every pair of agent states across hosts", () => {
    const statuses = new Set<FaviconStatus>();
    for (const first of AGENT_STATES) {
      for (const second of AGENT_STATES) {
        const sessionAgents: SessionAgentMaps = {
          "server-a": new Map([["a", makeAgent("a", first)]]),
          "server-b": new Map([["b", makeAgent("b", second)]]),
        };
        expectSameStatus(sessionAgents);
        statuses.add(deriveFaviconStatusFromSessionAgents(sessionAgents));
      }
    }
    expect(statuses).toEqual(new Set(["none", "running", "attention"]));
  });
});
