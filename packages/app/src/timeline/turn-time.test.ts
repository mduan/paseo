import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { deriveStreamTurnTiming } from "./turn-time";
import type { StreamItem } from "@/types/stream";
import { AgentForkMode } from "@getpaseo/protocol/agent-labels";

function user(id: string, timestamp: Date): StreamItem {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp,
  };
}

function assistant(id: string, timestamp: Date): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp,
  };
}

describe("deriveStreamTurnTiming", () => {
  it("keeps a fork marker out of the copied turn and times the next turn from its prompt", () => {
    const marker: StreamItem = {
      kind: "fork_marker",
      id: "marker",
      timestamp: new Date("2026-05-15T00:10:00.000Z"),
      sourceAgentId: "source",
      mode: AgentForkMode.Full,
    };

    const timing = deriveStreamTurnTiming({
      isTurnActive: false,
      activeTurnStartedAt: null,
      tail: [
        user("u1", new Date("2026-05-15T00:00:00.000Z")),
        assistant("a1", new Date("2026-05-15T00:00:05.000Z")),
        marker,
        user("u2", new Date("2026-05-15T00:10:00.000Z")),
        assistant("a2", new Date("2026-05-15T00:10:03.000Z")),
      ],
      head: [],
    });

    assert.equal(timing.byAssistantId.get("a1")?.durationMs, 5000);
    assert.equal(timing.byAssistantId.get("a2")?.durationMs, 3000);
  });

  it("starts elapsed time from the submitted prompt", () => {
    const submittedAt = new Date("2026-05-15T00:00:00.000Z");

    const timing = deriveStreamTurnTiming({
      isTurnActive: true,
      activeTurnStartedAt: submittedAt,
      tail: [],
      head: [user("submitted", submittedAt)],
    });

    assert.equal(timing.runningStartedAt, submittedAt);
  });

  it("uses the last user message as the running turn start", () => {
    const firstUserAt = new Date("2026-05-15T00:00:00.000Z");
    const secondUserAt = new Date("2026-05-15T00:01:00.000Z");

    const timing = deriveStreamTurnTiming({
      isTurnActive: true,
      activeTurnStartedAt: secondUserAt,
      tail: [
        user("u1", firstUserAt),
        assistant("a1", new Date("2026-05-15T00:00:05.000Z")),
        user("u2", secondUserAt),
      ],
      head: [assistant("a2", new Date("2026-05-15T00:01:04.000Z"))],
    });

    assert.equal(timing.runningStartedAt, secondUserAt);
    assert.equal(timing.byAssistantId.has("a2"), false);
  });

  it("derives completed turn timing from user and assistant item timestamps", () => {
    const userAt = new Date("2026-05-15T00:00:00.000Z");
    const assistantAt = new Date("2026-05-15T00:00:07.000Z");

    const timing = deriveStreamTurnTiming({
      isTurnActive: false,
      activeTurnStartedAt: null,
      tail: [
        user("u1", userAt),
        assistant("a1", assistantAt),
        user("u2", new Date("2026-05-15T00:01:00.000Z")),
      ],
      head: [],
    });

    assert.deepEqual(timing.byAssistantId.get("a1"), {
      completedAt: assistantAt,
      durationMs: 7000,
    });
  });

  it("maps multiple assistant chunks in one turn to the same timing", () => {
    const userAt = new Date("2026-05-15T00:00:00.000Z");
    const firstAssistantAt = new Date("2026-05-15T00:00:03.000Z");
    const lastAssistantAt = new Date("2026-05-15T00:00:07.000Z");

    const timing = deriveStreamTurnTiming({
      isTurnActive: false,
      activeTurnStartedAt: null,
      tail: [
        user("u1", userAt),
        assistant("a1", firstAssistantAt),
        assistant("a2", lastAssistantAt),
      ],
      head: [],
    });

    const expected = {
      completedAt: lastAssistantAt,
      durationMs: 7000,
    };
    assert.deepEqual(timing.byAssistantId.get("a1"), expected);
    assert.deepEqual(timing.byAssistantId.get("a2"), expected);
  });

  it("preserves the completion timestamp when a canonical turn has no visible prompt", () => {
    const firstTurnAt = new Date("2026-05-15T00:00:00.000Z");
    const hiddenPromptTurnAt = new Date("2026-05-15T00:01:07.000Z");
    const timing = deriveStreamTurnTiming({
      isTurnActive: false,
      activeTurnStartedAt: null,
      tail: [
        { ...user("u1", firstTurnAt), turnId: "turn-1" },
        {
          ...assistant("a1", new Date("2026-05-15T00:00:07.000Z")),
          turnId: "turn-1",
        },
        {
          ...assistant("hidden-prompt-a1", new Date("2026-05-15T00:01:03.000Z")),
          turnId: "turn-2",
        },
        { ...assistant("hidden-prompt-a2", hiddenPromptTurnAt), turnId: "turn-2" },
      ],
      head: [],
    });

    assert.deepEqual(timing.byAssistantId.get("hidden-prompt-a2"), {
      completedAt: hiddenPromptTurnAt,
      durationMs: null,
    });
  });
});
