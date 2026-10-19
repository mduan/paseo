import { expect, it } from "vitest";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { searchTimeline } from "./index.js";

function rows(items: AgentTimelineItem[]) {
  return items.map((item, index) => ({ item, seq: index + 1, timestamp: "2026-09-12T00:00:00Z" }));
}

it("returns source locations for formatted assistant text and literal user text", async () => {
  const result = await searchTimeline({
    rows: rows([
      { type: "user_message", text: "hello **world**" },
      { type: "assistant_message", text: "İ😀hello **world** and hello *world*" },
      {
        type: "assistant_message",
        text: "[hello &amp; world](https://example.com)",
        messageId: "separate",
      },
    ]),
    query: "hello world",
  });
  expect(result).toEqual({
    locations: [{ seq: 2, role: "assistant", count: 2, folded: true }],
    nextCursor: null,
  });
});

it("finds code and literal punctuation without searching tools, reasoning, or task state", async () => {
  const result = await searchTimeline({
    rows: rows([
      { type: "assistant_message", text: "```ts\nconst value = 'a.b';\n```" },
      { type: "reasoning", text: "a.b" },
      { type: "todo", items: [{ text: "a.b", completed: false }] },
      { type: "user_message", text: "axb" },
      { type: "user_message", text: "a.b" },
    ]),
    query: "a.b",
  });
  expect(result.locations).toEqual([
    { seq: 1, role: "assistant", count: 1, folded: false },
    { seq: 5, role: "user", count: 1, folded: false },
  ]);
});

it("bounds results and resumes without losing locations", async () => {
  const source = rows(
    Array.from({ length: 202 }, () => ({ type: "user_message", text: "target" })),
  );
  const first = await searchTimeline({ rows: source, query: "target" });
  expect(first.locations).toHaveLength(200);
  expect(first.nextCursor).toBe(200);
  const second = await searchTimeline({ rows: source, query: "target", cursor: first.nextCursor! });
  expect(second).toEqual({
    locations: [
      { seq: 201, role: "user", count: 1, folded: false },
      { seq: 202, role: "user", count: 1, folded: false },
    ],
    nextCursor: null,
  });
});

it("finds ordinary Markdown entities and line breaks without requiring identical parsers", async () => {
  const source = rows([{ type: "assistant_message", text: "hello &amp; **world**\nnext line" }]);
  expect((await searchTimeline({ rows: source, query: "hello & world" })).locations).toEqual([
    { seq: 1, role: "assistant", count: 1, folded: false },
  ]);
  expect((await searchTimeline({ rows: source, query: "world next" })).locations).toEqual([
    { seq: 1, role: "assistant", count: 1, folded: false },
  ]);
});

it("counts occurrences per rendered block rather than across block boundaries", async () => {
  const source = rows([
    { type: "assistant_message", text: "target one\n\ntarget two\n\n- target three\n- end target" },
    { type: "user_message", text: "TARGET target" },
  ]);
  expect((await searchTimeline({ rows: source, query: "target" })).locations).toEqual([
    { seq: 1, role: "assistant", count: 4, folded: false },
    { seq: 2, role: "user", count: 2, folded: false },
  ]);
  expect((await searchTimeline({ rows: source, query: "end target" })).locations).toEqual([
    { seq: 1, role: "assistant", count: 1, folded: false },
  ]);
  expect((await searchTimeline({ rows: source, query: "two target" })).locations).toEqual([]);
  // Rendered text never runs from the end of one block into the start of the next, so
  // neither does a match, however contiguous the Markdown source looks.
  expect((await searchTimeline({ rows: source, query: "one target" })).locations).toEqual([]);
});

it("counts case-sensitive, whole-word, and regex matches and skips empty matches", async () => {
  const source = rows([{ type: "user_message", text: "Retry retry retrying éretry retry2" }]);
  expect(
    (await searchTimeline({ rows: source, query: "retry", options: { caseSensitive: true } }))
      .locations,
  ).toEqual([{ seq: 1, role: "user", count: 4, folded: false }]);
  expect(
    (await searchTimeline({ rows: source, query: "retry", options: { wholeWord: true } }))
      .locations,
  ).toEqual([{ seq: 1, role: "user", count: 2, folded: false }]);
  expect(
    (await searchTimeline({ rows: source, query: "retry[0-9]+", options: { regex: true } }))
      .locations,
  ).toEqual([{ seq: 1, role: "user", count: 1, folded: false }]);
  expect(
    (await searchTimeline({ rows: source, query: "z*", options: { regex: true } })).locations,
  ).toEqual([]);
  await expect(
    searchTimeline({ rows: source, query: "(", options: { regex: true } }),
  ).rejects.toThrow("Invalid regular expression");
});

it("marks completed work before paging and never folds user messages or the running last turn", async () => {
  const source = rows([
    { type: "user_message", text: "target prompt" },
    { type: "assistant_message", text: "target work", messageId: "work" },
    { type: "user_message", text: "target steer" },
    { type: "assistant_message", text: "target final", messageId: "final" },
    { type: "user_message", text: "target next" },
    { type: "assistant_message", text: "target next work", messageId: "next-work" },
    { type: "assistant_message", text: "target next final", messageId: "next-final" },
  ]).map((row) => ({
    seq: row.seq,
    timestamp: row.timestamp,
    item: row.item,
    turnId: row.seq <= 4 ? "t1" : "t2",
  }));
  const completed = await searchTimeline({ rows: source, query: "target", cursor: 1 });
  expect(completed.locations).toEqual([
    { seq: 2, role: "assistant", count: 1, folded: true, turnId: "t1" },
    { seq: 3, role: "user", count: 1, folded: false, turnId: "t1" },
    { seq: 4, role: "assistant", count: 1, folded: false, turnId: "t1" },
    { seq: 5, role: "user", count: 1, folded: false, turnId: "t2" },
    { seq: 6, role: "assistant", count: 1, folded: true, turnId: "t2" },
    { seq: 7, role: "assistant", count: 1, folded: false, turnId: "t2" },
  ]);
  const live = await searchTimeline({ rows: source, query: "target", isRunning: true });
  expect(
    live.locations.filter((location) => location.folded).map((location) => location.seq),
  ).toEqual([2]);
});

it("sees the final assistant message beyond the search page", async () => {
  const source = rows([
    { type: "user_message", text: "target" },
    ...Array.from({ length: 202 }, (_, index) => ({
      type: "assistant_message" as const,
      text: "target",
      messageId: String(index),
    })),
  ]);
  const first = await searchTimeline({ rows: source, query: "target" });
  expect(first.locations.filter((location) => location.folded)).toHaveLength(199);
  const second = await searchTimeline({ rows: source, query: "target", cursor: first.nextCursor! });
  expect(second.locations).toEqual([
    { seq: 201, role: "assistant", count: 1, folded: true },
    { seq: 202, role: "assistant", count: 1, folded: true },
    { seq: 203, role: "assistant", count: 1, folded: false },
  ]);
});
