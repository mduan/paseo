import { expect, it } from "vitest";
import { completedTurnFolds, type TurnItem } from "./turns.js";

type Item = TurnItem & { id: string; messageId?: string };
function folds(items: Item[], lastTurnIsLive = false) {
  return completedTurnFolds({
    items,
    lastTurnIsLive,
    getMessageId: (item) => item.messageId ?? item.id,
  }).map((turn) => ({
    ids: turn.items.map((item) => item.id),
    folded: [...turn.folded].map((item) => item.id),
  }));
}

it("groups legacy user and fork boundaries while preserving prompts", () => {
  expect(
    folds([
      { id: "p1", kind: "user_message" },
      { id: "work", kind: "assistant_message" },
      { id: "final", kind: "assistant_message" },
      { id: "fork", kind: "fork_marker" },
      { id: "p2", kind: "user_message" },
      { id: "thought", kind: "reasoning" },
      { id: "next", kind: "assistant_message" },
    ]),
  ).toEqual([
    { ids: ["p1", "work", "final"], folded: ["work"] },
    { ids: ["fork", "p2", "thought", "next"], folded: ["thought"] },
  ]);
});

it("keeps steers in a canonical turn and folds Codex's leading rule with the earlier work", () => {
  const items = [
    { id: "p", kind: "user_message", turnId: "turn" },
    { id: "work", kind: "assistant_message", turnId: "turn" },
    { id: "steer", kind: "user_message", turnId: "turn" },
    { id: "rule", kind: "assistant_message", turnId: "turn", messageId: "final", text: "---\n" },
    { id: "final", kind: "assistant_message", turnId: "turn", messageId: "final", text: "Done" },
  ];
  expect(folds(items)).toEqual([
    { ids: ["p", "work", "steer", "rule", "final"], folded: ["work", "rule"] },
  ]);
  expect(folds(items, true)).toEqual([
    { ids: ["p", "work", "steer", "rule", "final"], folded: [] },
  ]);
});

it("keeps unfinished turns and hidden-prompt turn boundaries", () => {
  expect(
    folds(
      [
        { id: "work", kind: "assistant_message", turnId: "first" },
        { id: "final", kind: "assistant_message", turnId: "first" },
        { id: "unfinished", kind: "reasoning", turnId: "second" },
      ],
      true,
    ),
  ).toEqual([
    { ids: ["work", "final"], folded: ["work"] },
    { ids: ["unfinished"], folded: [] },
  ]);
});
