import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
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
    expect(fold({})).toEqual({
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
    expect(toggles.w1).toEqual({ turnKey: "t1", expanded: true });
  });

  it("never folds the active turn", () => {
    expect(fold({ isTurnActive: true, activeTurnId: "t2" }).ids.slice(-3)).toEqual([
      "p2",
      "w3",
      "a2",
    ]);
  });
});
