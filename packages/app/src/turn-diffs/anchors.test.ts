import { describe, expect, it } from "vitest";
import type { TurnDiffSummary } from "@getpaseo/protocol/messages";
import type { StreamItem } from "@/types/stream";
import { anchorTurnDiffs } from "./anchors";

const timestamp = new Date("2026-01-01T00:00:00.000Z");

function user(id: string, extra: { turnId?: string; messageId?: string } = {}): StreamItem {
  return { kind: "user_message", id, text: id, timestamp, ...extra };
}

function assistant(id: string, turnId?: string): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp, ...(turnId ? { turnId } : {}) };
}

function summary(turnId: string, userMessageIds: string[]): TurnDiffSummary {
  return {
    turnId,
    userMessageIds,
    completedAt: timestamp.toISOString(),
    files: [{ path: "a.txt", additions: 1, deletions: 0 }],
  };
}

describe("anchorTurnDiffs", () => {
  it("anchors a live turn on its last assistant message by turn id", () => {
    const turn = summary("t1", ["client-1"]);
    const anchors = anchorTurnDiffs({
      tail: [
        user("client-1", { turnId: "t1" }),
        assistant("a1", "t1"),
        assistant("a2", "t1"),
        user("client-2", { turnId: "t2" }),
        assistant("a3", "t2"),
      ],
      turns: [turn],
    });
    expect([...anchors]).toEqual([["a2", turn]]);
  });

  it("matches rebuilt rows without turn ids through the provider message id", () => {
    const turn = summary("foreground-turn-1", ["client-1", "provider-1"]);
    const anchors = anchorTurnDiffs({
      tail: [
        user("row-1", { messageId: "provider-1" }),
        assistant("a1"),
        user("row-2", { messageId: "provider-2" }),
        assistant("a2"),
      ],
      turns: [turn],
    });
    expect([...anchors]).toEqual([["a1", turn]]);
  });

  it("skips a turn that has no assistant message", () => {
    const anchors = anchorTurnDiffs({
      tail: [user("client-1", { turnId: "t1" })],
      turns: [summary("t1", ["client-1"])],
    });
    expect(anchors.size).toBe(0);
  });
});
