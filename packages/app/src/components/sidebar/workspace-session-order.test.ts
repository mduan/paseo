import { describe, expect, it } from "vitest";
import {
  orderWorkspaceSessions,
  selectWorkspaceSessionAgentIds,
  type WorkspaceSessionAgent,
} from "@/components/sidebar/workspace-session-order";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/workspace-tabs/model";

function tab(tabId: string, target: WorkspaceTabTarget): WorkspaceTab {
  return { tabId, target, createdAt: 0 };
}

const ALL = { agents: true, terminals: true, browsers: true };

describe("orderWorkspaceSessions", () => {
  it("follows tab order, then appends sessions without a tab", () => {
    const rows = orderWorkspaceSessions({
      tabs: [
        tab("t1", { kind: "terminal", terminalId: "term-1" }),
        tab("t2", { kind: "files" }),
        tab("t3", { kind: "agent", agentId: "a2" }),
        tab("t4", { kind: "browser", browserId: "b1" }),
      ],
      agentIds: ["a1", "a2"],
      terminalIds: ["term-1", "term-2"],
      kinds: ALL,
    });
    expect(rows.map((row) => [row.key, row.tabId])).toEqual([
      ["terminal:term-1", "t1"],
      ["agent:a2", "t3"],
      ["browser:b1", "t4"],
      ["agent:a1", null],
      ["terminal:term-2", null],
    ]);
  });

  it("drops archived or hidden agents still holding a tab and switched-off kinds", () => {
    const rows = orderWorkspaceSessions({
      tabs: [
        tab("t1", { kind: "agent", agentId: "gone" }),
        tab("t2", { kind: "browser", browserId: "b1" }),
        tab("t3", { kind: "terminal", terminalId: "term-1" }),
      ],
      agentIds: ["a1"],
      terminalIds: ["term-1"],
      kinds: { agents: true, terminals: false, browsers: false },
    });
    expect(rows.map((row) => row.key)).toEqual(["agent:a1"]);
  });
});

function agent(id: string, fields: Partial<WorkspaceSessionAgent> = {}): WorkspaceSessionAgent {
  return { id, workspaceId: "ws-1", parentAgentId: null, createdAt: new Date(0), ...fields };
}

function agentMap(...agents: WorkspaceSessionAgent[]): Map<string, WorkspaceSessionAgent> {
  return new Map(agents.map((entry) => [entry.id, entry]));
}

describe("selectWorkspaceSessionAgentIds", () => {
  const base = { agentDetails: undefined, hiddenAgentIds: undefined, tabs: [] };

  it("lists the workspace's visible root agents oldest first", () => {
    const agents = agentMap(
      agent("newer", { createdAt: new Date(2) }),
      agent("older", { createdAt: new Date(1) }),
      agent("archived", { archivedAt: new Date(3) }),
      agent("hidden"),
      agent("elsewhere", { workspaceId: "ws-2" }),
      agent("child", { parentAgentId: "older" }),
      agent("opened-child", { parentAgentId: "older", createdAt: new Date(3) }),
    );
    const ids = selectWorkspaceSessionAgentIds({
      ...base,
      agents,
      workspaceId: "ws-1",
      hiddenAgentIds: new Set(["hidden"]),
      tabs: [tab("t1", { kind: "agent", agentId: "opened-child" })],
    });
    expect(ids).toEqual(["older", "newer", "opened-child"]);
    expect(selectWorkspaceSessionAgentIds({ ...base, agents, workspaceId: "ws-2" })).toEqual([
      "elsewhere",
    ]);
  });

  it("reflects agent changes once the agents map is replaced", () => {
    const first = agentMap(agent("a1"));
    expect(selectWorkspaceSessionAgentIds({ ...base, agents: first, workspaceId: "ws-1" })).toEqual(
      ["a1"],
    );
    const next = agentMap(agent("a1", { archivedAt: new Date(1) }), agent("a2"));
    expect(selectWorkspaceSessionAgentIds({ ...base, agents: next, workspaceId: "ws-1" })).toEqual([
      "a2",
    ]);
  });
});
