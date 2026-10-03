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
