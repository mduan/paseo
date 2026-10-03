import { describe, expect, it } from "vitest";
import type { AgentToolCallData, StreamItem } from "@/types/stream";
import { AgentForkMode } from "@getpaseo/protocol/agent-labels";
import { foldCompletedTurns } from "./collapse-completed-turns";

const timestamp = new Date("2026-01-01T00:00:00.000Z");

function user(id: string, turnId: string): StreamItem {
  return { kind: "user_message", id, text: id, timestamp, turnId };
}

function assistant(id: string, turnId: string, blockGroupId?: string): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp, turnId, blockGroupId };
}

function thought(id: string, turnId: string): StreamItem {
  return { kind: "thought", id, text: id, timestamp, turnId, status: "ready" };
}

function tool(
  id: string,
  turnId: string,
  detail: AgentToolCallData["detail"],
  status: AgentToolCallData["status"],
): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp,
    turnId,
    payload: {
      source: "agent",
      data: { provider: "claude", callId: id, name: detail.type, status, error: null, detail },
    },
  };
}

// prompt, work, steer, more work, then a final answer split into two blocks.
const turn1 = [
  user("p1", "t1"),
  thought("w1", "t1"),
  assistant("a1", "t1"),
  user("steer", "t1"),
  thought("w2", "t1"),
  assistant("final:0", "t1", "final"),
  assistant("final:1", "t1", "final"),
];
const turn2 = [user("p2", "t2"), thought("w3", "t2"), assistant("a2", "t2")];

function fold(input: { isTurnActive?: boolean; activeTurnId?: string; expanded?: string[] }) {
  const folded = foldCompletedTurns({
    tail: [...turn1, ...turn2],
    head: [],
    isTurnActive: input.isTurnActive ?? false,
    activeTurnId: input.activeTurnId ?? null,
    expandedTurnKeys: new Set(input.expanded),
  });
  return { ids: folded.items.map((item) => item.id), toggles: Object.fromEntries(folded.toggles) };
}

describe("foldCompletedTurns", () => {
  it("hides work before the final message and keeps user messages", () => {
    expect(fold({})).toMatchObject({
      ids: ["p1", "steer", "final:0", "final:1", "p2", "a2"],
      toggles: {
        steer: { turnKey: "t1", expanded: false },
        a2: { turnKey: "t2", expanded: false },
      },
    });
  });

  it("keeps an expanded turn whole with the toggle above its first work row", () => {
    const { ids, toggles } = fold({ expanded: ["t1"] });
    expect(ids.slice(0, turn1.length)).toEqual(turn1.map((item) => item.id));
    expect(toggles.w1).toMatchObject({ turnKey: "t1", expanded: true });
  });

  it("times the turn from its prompt to its last row", () => {
    const at = (seconds: number) => new Date(timestamp.getTime() + seconds * 1000);
    const folded = foldCompletedTurns({
      tail: [
        { ...user("p", "t"), timestamp: at(0) },
        { ...thought("w", "t"), timestamp: at(5) },
        { ...assistant("a", "t"), timestamp: at(12) },
      ],
      head: [],
      isTurnActive: false,
      activeTurnId: null,
      expandedTurnKeys: new Set(),
    });
    expect(folded.toggles.get("a")).toMatchObject({ hasWork: true, durationMs: 12_000 });
  });

  it("gives a turn without work a duration-only row", () => {
    const folded = foldCompletedTurns({
      tail: [user("p", "t"), assistant("a", "t")],
      head: [],
      isTurnActive: false,
      activeTurnId: null,
      expandedTurnKeys: new Set(),
    });
    expect(folded.items.map((item) => item.id)).toEqual(["p", "a"]);
    expect(folded.toggles.get("a")).toMatchObject({ hasWork: false, durationMs: 0 });
  });

  it("folds the rule Codex puts before a later message with the work", () => {
    const rule: StreamItem = {
      kind: "assistant_message",
      id: "final:0",
      text: "---",
      timestamp,
      turnId: "t",
      blockGroupId: "final",
    };
    const tail = [
      user("p", "t"),
      assistant("intro", "t"),
      tool("shell", "t", { type: "shell", command: "ls" }, "completed"),
      rule,
      assistant("final:1", "t", "final"),
    ];
    const foldRuleTurn = (expanded: string[]) =>
      foldCompletedTurns({
        tail,
        head: [],
        isTurnActive: false,
        activeTurnId: null,
        expandedTurnKeys: new Set(expanded),
      }).items.map((item) => item.id);
    expect(foldRuleTurn([])).toEqual(["p", "final:1"]);
    expect(foldRuleTurn(["t"])).toEqual(tail.map((item) => item.id));
  });

  it("keeps a fork marker visible above the folded work", () => {
    const marker: StreamItem = {
      kind: "fork_marker",
      id: "marker",
      timestamp,
      sourceAgentId: "source",
      mode: AgentForkMode.Full,
    };
    const folded = foldCompletedTurns({
      tail: [marker, user("p", "t"), thought("w", "t"), assistant("a", "t")],
      head: [],
      isTurnActive: false,
      activeTurnId: null,
      expandedTurnKeys: new Set(),
    });
    expect(folded.items.map((item) => item.id)).toEqual(["marker", "p", "a"]);
    expect(folded.toggles.get("a")).toMatchObject({ hasWork: true });
  });

  it("never folds the active turn", () => {
    expect(fold({ isTurnActive: true, activeTurnId: "t2" }).ids.slice(-3)).toEqual([
      "p2",
      "w3",
      "a2",
    ]);
  });
});
