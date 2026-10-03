import { describe, expect, it } from "vitest";
import { orderWorkspaceSessions } from "@/components/sidebar/workspace-session-order";
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
