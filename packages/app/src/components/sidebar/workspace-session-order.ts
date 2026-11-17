import type { Agent } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/workspace-tabs/model";

export type WorkspaceSessionTarget = Extract<
  WorkspaceTabTarget,
  { kind: "agent" | "terminal" | "browser" }
>;

export interface WorkspaceSessionRow {
  key: string;
  tabId: string | null;
  target: WorkspaceSessionTarget;
}

export interface WorkspaceSessionKinds {
  agents: boolean;
  terminals: boolean;
  browsers: boolean;
}

function sessionKey(target: WorkspaceSessionTarget): string {
  if (target.kind === "agent") return `agent:${target.agentId}`;
  if (target.kind === "terminal") return `terminal:${target.terminalId}`;
  return `browser:${target.browserId}`;
}

/**
 * Tab order where this device has a layout for the workspace; sessions without a tab yet go
 * last, oldest first. Tab reconciliation appends new tabs at the end too, so the order holds
 * when the layout catches up.
 */
export function orderWorkspaceSessions(input: {
  tabs: readonly WorkspaceTab[];
  agentIds: readonly string[];
  terminalIds: readonly string[];
  kinds: WorkspaceSessionKinds;
}): WorkspaceSessionRow[] {
  const agentIds = new Set(input.kinds.agents ? input.agentIds : []);
  const terminalIds = new Set(input.kinds.terminals ? input.terminalIds : []);
  const rows: WorkspaceSessionRow[] = [];
  const seen = new Set<string>();
  const push = (target: WorkspaceSessionTarget, tabId: string | null) => {
    const key = sessionKey(target);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ key, tabId, target });
  };
  for (const tab of input.tabs) {
    const { target } = tab;
    if (target.kind === "agent" && agentIds.has(target.agentId)) push(target, tab.tabId);
    else if (target.kind === "terminal" && terminalIds.has(target.terminalId))
      push(target, tab.tabId);
    else if (target.kind === "browser" && input.kinds.browsers) push(target, tab.tabId);
  }
  for (const agentId of agentIds) push({ kind: "agent", agentId }, null);
  for (const terminalId of terminalIds) push({ kind: "terminal", terminalId }, null);
  return rows;
}

export type WorkspaceSessionAgent = Pick<
  Agent,
  "id" | "archivedAt" | "workspaceId" | "parentAgentId" | "createdAt"
>;

const NO_AGENTS: WorkspaceSessionAgent[] = [];
const NO_AGENT_IDS: string[] = [];

// Every sidebar workspace selects its agents on each session-store commit, so the grouping is
// built once per `agents` Map and shared instead of rescanning every agent per workspace.
const unarchivedAgentsByWorkspace = new WeakMap<
  ReadonlyMap<string, WorkspaceSessionAgent>,
  Map<string, WorkspaceSessionAgent[]>
>();

function getUnarchivedAgentsByWorkspace(
  agents: ReadonlyMap<string, WorkspaceSessionAgent>,
): Map<string, WorkspaceSessionAgent[]> {
  let index = unarchivedAgentsByWorkspace.get(agents);
  if (index) return index;
  index = new Map();
  for (const agent of agents.values()) {
    if (agent.archivedAt) continue;
    const workspaceId = normalizeWorkspaceOpaqueId(agent.workspaceId);
    if (!workspaceId) continue;
    const workspaceAgents = index.get(workspaceId);
    if (workspaceAgents) workspaceAgents.push(agent);
    else index.set(workspaceId, [agent]);
  }
  for (const workspaceAgents of index.values()) {
    workspaceAgents.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  unarchivedAgentsByWorkspace.set(agents, index);
  return index;
}

/**
 * The workspace's sidebar agents, oldest first: unarchived, not hidden, and either a workspace
 * root or open in a tab.
 */
export function selectWorkspaceSessionAgentIds(input: {
  agents: ReadonlyMap<string, WorkspaceSessionAgent>;
  agentDetails: ReadonlyMap<string, WorkspaceSessionAgent> | undefined;
  workspaceId: string;
  hiddenAgentIds: ReadonlySet<string> | undefined;
  tabs: readonly WorkspaceTab[];
}): string[] {
  const { agents, agentDetails, hiddenAgentIds, tabs } = input;
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if (!workspaceId) return NO_AGENT_IDS;
  const workspaceAgents = getUnarchivedAgentsByWorkspace(agents).get(workspaceId) ?? NO_AGENTS;
  const ids: string[] = [];
  for (const agent of workspaceAgents) {
    // `/clear` and friends hide the agent they replace; it stays unarchived but has no tab.
    if (hiddenAgentIds?.has(agent.id)) continue;
    const parent = agent.parentAgentId
      ? (agents.get(agent.parentAgentId) ?? agentDetails?.get(agent.parentAgentId))
      : undefined;
    const hasOpenTab = tabs.some(
      (tab) => tab.target.kind === "agent" && tab.target.agentId === agent.id,
    );
    if (isWorkspaceRootAgent(agent, parent) || hasOpenTab) ids.push(agent.id);
  }
  return ids;
}
