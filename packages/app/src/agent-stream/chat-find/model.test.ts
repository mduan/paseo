import { expect, it } from "vitest";
import { hydrateStreamState, type StreamItem } from "@/types/stream";
import {
  ChatFindModel,
  type ChatFindSearch,
  type ChatFindReveal,
  type ChatFindOperations,
} from "./model";

function response(locations: Awaited<ReturnType<ChatFindOperations["search"]>>["locations"]) {
  return {
    agentId: "agent",
    requestId: "request",
    epoch: "epoch",
    locations,
    nextCursor: null,
    error: null,
  };
}
function message(seq: number, text = "target"): StreamItem {
  return {
    id: `row-${seq}`,
    kind: "assistant_message",
    text,
    timestamp: new Date(0),
    timelineCursor: { epoch: "epoch", seq },
  };
}

it("loads an older location and searches a response merged across suppressed tasks once", async () => {
  const source = [
    { type: "assistant_message" as const, text: "first **target** " },
    {
      type: "tool_call" as const,
      callId: "task",
      name: "TaskCreate",
      status: "completed" as const,
      detail: { type: "unknown" as const, input: {}, output: null },
      error: null,
    },
    { type: "assistant_message" as const, text: "second target" },
  ];
  const history = hydrateStreamState(
    source.map((item, index) => ({
      event: { type: "timeline" as const, provider: "claude" as const, item },
      timestamp: new Date(0),
      timelineCursor: { epoch: "epoch", seq: index + 1 },
    })),
    { source: "canonical" },
  );
  expect(history).toHaveLength(1);
  const loaded: number[] = [];
  const revealed: number[] = [];
  const model = new ChatFindModel({
    operations: {
      async search() {
        return response([
          { seq: 1, role: "assistant" },
          { seq: 3, role: "assistant" },
        ]);
      },
      async load(_epoch, seq) {
        loaded.push(seq);
        model.updateHistory({ epoch: "epoch", items: history });
      },
      async reveal({ occurrence }) {
        revealed.push(occurrence);
        return { count: 2, occurrence: occurrence < 0 ? 1 : occurrence };
      },
      clear() {},
    },
  });
  try {
    model.updateHistory({ epoch: "epoch", items: [] });
    model.open();
    model.setQuery("target");
    await expect.poll(() => model.getSnapshot().phase).toBe("ready");
    model.next();
    await expect.poll(() => model.getSnapshot().occurrence).toBe(1);
    model.next();
    await expect.poll(() => revealed).toEqual([0, 1, 0]);
    model.previous();
    await expect.poll(() => model.getSnapshot().occurrence).toBe(1);
    expect(loaded).toEqual([1]);
  } finally {
    model.close();
  }
});

it("skips a source-only candidate and highlights a displayed match", async () => {
  const revealed: string[] = [];
  const model = new ChatFindModel({
    operations: {
      async search() {
        return response([
          { seq: 1, role: "assistant" },
          { seq: 2, role: "assistant" },
        ]);
      },
      async load() {
        throw new Error("Already loaded");
      },
      async reveal({ messageId: id }) {
        revealed.push(id);
        return { count: id === "row-1" ? 0 : 1, occurrence: 0 };
      },
      clear() {},
    },
  });
  try {
    model.updateHistory({ epoch: "epoch", items: [message(1), message(2)] });
    model.open();
    model.setQuery("target");
    await expect.poll(() => model.getSnapshot().selectedItemId).toBe("row-2");
    expect(revealed).toEqual(["row-1", "row-2"]);
    expect(model.getSnapshot().phase).toBe("ready");
  } finally {
    model.close();
  }
});

it("ignores replies after closing and does not navigate", async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  const calls: string[] = [];
  const model = new ChatFindModel({
    operations: {
      search() {
        calls.push("search");
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      async load() {
        calls.push("load");
      },
      async reveal() {
        calls.push("reveal");
        return { count: 1, occurrence: 0 };
      },
      clear() {},
    },
  });
  model.updateHistory({ epoch: "epoch", items: [message(1)] });
  model.open();
  model.setQuery("target");
  await expect.poll(() => calls).toEqual(["search"]);
  model.close();
  finish(response([{ seq: 1, role: "assistant" }]));
  await Promise.resolve();
  expect(calls).toEqual(["search"]);
  expect(model.getSnapshot()).toMatchObject({ open: false, phase: "idle" });
});

it("retains a failed search for retry and distinguishes failure from zero matches", async () => {
  let disconnected = true;
  const operations: ChatFindOperations = {
    async search() {
      if (disconnected) throw new Error("Host disconnected");
      return response([]);
    },
    async load() {},
    async reveal() {
      return { count: 0, occurrence: 0 };
    },
    clear() {},
  };
  const model = new ChatFindModel({ operations });
  try {
    model.updateHistory({ epoch: "epoch", items: [] });
    model.open();
    model.setQuery("target");
    await expect.poll(() => model.getSnapshot().phase).toBe("error");
    expect(model.getSnapshot().failure).toBe("connection");
    disconnected = false;
    model.retry();
    await expect.poll(() => model.getSnapshot().phase).toBe("ready");
    expect(model.getSnapshot()).toMatchObject({ count: 0, failure: null });
  } finally {
    model.close();
  }
});

// `load` is a host RPC like `search`, so its failure is a connection failure and the
// widget must say so rather than blaming the reveal.
it("reports a failed timeline load as a connection failure", async () => {
  const model = new ChatFindModel({
    operations: {
      async search() {
        return response([{ seq: 1, role: "assistant" }]);
      },
      async load() {
        throw new Error("Host disconnected");
      },
      async reveal() {
        return { count: 1, occurrence: 0 };
      },
      clear() {},
    },
  });
  try {
    model.updateHistory({ epoch: "epoch", items: [] });
    model.open();
    model.setQuery("target");
    await expect.poll(() => model.getSnapshot().phase).toBe("error");
    expect(model.getSnapshot().failure).toBe("connection");
  } finally {
    model.close();
  }
});

it("reports a search result that outlived its epoch as a changed history", async () => {
  const model = new ChatFindModel({
    operations: {
      async search() {
        return response([{ seq: 1, role: "assistant" }]);
      },
      async load() {},
      async reveal() {
        return { count: 1, occurrence: 0 };
      },
      clear() {},
    },
  });
  try {
    model.updateHistory({ epoch: "epoch", items: [message(1)] });
    model.open();
    model.setQuery("target");
    await expect.poll(() => model.getSnapshot().phase).toBe("ready");
    model.updateHistory({ epoch: "epoch-2", items: [message(1)] });
    expect(model.getSnapshot()).toMatchObject({ phase: "error", failure: "historyChanged" });
  } finally {
    model.close();
  }
});

it("can load a search location before the initial chat history has arrived", async () => {
  const model = new ChatFindModel({
    operations: {
      async search() {
        return response([{ seq: 1, role: "assistant" }]);
      },
      async load() {
        model.updateHistory({ epoch: "epoch", items: [message(1)] });
      },
      async reveal() {
        return { count: 1, occurrence: 0 };
      },
      clear() {},
    },
  });
  try {
    model.updateHistory({ epoch: null, items: [] });
    model.open();
    model.setQuery("target");
    await expect.poll(() => model.getSnapshot().phase).toBe("ready");
    expect(model.getSnapshot()).toMatchObject({ selectedItemId: "row-1", count: 1, failure: null });
  } finally {
    model.close();
  }
});

// The scope of the search is the whole chat, so the position spans every located
// message: the host's estimate until a message is on screen, the rendered count after.
it("reports the position across the whole chat and corrects it with rendered counts", async () => {
  const model = new ChatFindModel({
    operations: {
      async search() {
        return response([
          { seq: 1, role: "assistant", count: 2 },
          { seq: 2, role: "assistant", count: 3 },
        ]);
      },
      async load() {},
      async reveal({ messageId: id, occurrence }) {
        const count = id === "row-1" ? 2 : 1;
        return { count, occurrence: occurrence < 0 ? count - 1 : occurrence };
      },
      clear() {},
    },
  });
  try {
    model.updateHistory({ epoch: "epoch", items: [message(1), message(2)] });
    model.open();
    model.setQuery("target");
    await expect.poll(() => model.getSnapshot().phase).toBe("ready");
    expect(model.getSnapshot()).toMatchObject({ selectedItemId: "row-1", occurrence: 0, count: 5 });
    model.next();
    await expect.poll(() => model.getSnapshot().occurrence).toBe(1);
    expect(model.getSnapshot().count).toBe(5);
    model.next();
    await expect.poll(() => model.getSnapshot().selectedItemId).toBe("row-2");
    expect(model.getSnapshot()).toMatchObject({ occurrence: 2, count: 3 });
    model.previous();
    await expect.poll(() => model.getSnapshot().selectedItemId).toBe("row-1");
    expect(model.getSnapshot()).toMatchObject({ occurrence: 1, count: 3 });
  } finally {
    model.close();
  }
});

// COMPAT(timelineSearchCount): a host that reports no counts is worth one match per
// located message until a reveal replaces the estimate with the rendered count.
it("counts one match per message from a host that reports no counts", async () => {
  const model = new ChatFindModel({
    operations: {
      async search() {
        return response([
          { seq: 1, role: "assistant" },
          { seq: 2, role: "assistant" },
        ]);
      },
      async load() {},
      async reveal({ messageId: id, occurrence }) {
        const count = id === "row-1" ? 2 : 1;
        return { count, occurrence: occurrence < 0 ? count - 1 : occurrence };
      },
      clear() {},
    },
  });
  try {
    model.updateHistory({ epoch: "epoch", items: [message(1), message(2)] });
    model.open();
    model.setQuery("target");
    await expect.poll(() => model.getSnapshot().phase).toBe("ready");
    expect(model.getSnapshot()).toMatchObject({ selectedItemId: "row-1", occurrence: 0, count: 3 });
    model.next();
    await expect.poll(() => model.getSnapshot().occurrence).toBe(1);
    model.next();
    await expect.poll(() => model.getSnapshot().selectedItemId).toBe("row-2");
    expect(model.getSnapshot()).toMatchObject({ occurrence: 2, count: 3 });
  } finally {
    model.close();
  }
});

it.each([
  { includeFolded: false, expanded: [], count: 1 },
  { includeFolded: true, expanded: [], count: 2 },
  { includeFolded: false, expanded: ["turn"], count: 2 },
  { includeFolded: false, expanded: ["row-1"], count: 2, legacy: true },
])(
  "filters folded locations with includeFolded=$includeFolded and expanded=$expanded",
  async ({ includeFolded, expanded, count, legacy }) => {
    const model = new ChatFindModel({
      operations: {
        async search() {
          return response([
            {
              seq: 1,
              role: "assistant",
              count: 1,
              folded: true,
              turnId: legacy ? undefined : "turn",
            },
            {
              seq: 2,
              role: "assistant",
              count: 1,
              folded: false,
              turnId: legacy ? undefined : "turn",
            },
          ]);
        },
        async load() {
          throw new Error("Already loaded");
        },
        async reveal() {
          return { count: 1, occurrence: 0 };
        },
        clear() {},
      },
    });
    try {
      model.updateHistory({
        epoch: "epoch",
        items: [message(1), message(2)],
        expandedTurnKeys: new Set(expanded),
      });
      model.open();
      model.setOptions({ includeFolded });
      model.setQuery("target");
      await expect.poll(() => model.getSnapshot().phase).toBe("ready");
      expect(model.getSnapshot().count).toBe(count);
    } finally {
      model.close();
    }
  },
);

it("re-runs changed options, keeps expanded matches when disabled, and resets options on close", async () => {
  const searches: ChatFindSearch[] = [];
  const reveals: ChatFindReveal[] = [];
  const model = new ChatFindModel({
    operations: {
      async search(input) {
        searches.push(input);
        return response([{ seq: 1, role: "assistant", count: 1, folded: true, turnId: "turn" }]);
      },
      async load() {
        throw new Error("Already loaded");
      },
      async reveal(input) {
        reveals.push(input);
        return { count: 1, occurrence: 0 };
      },
      clear() {},
    },
  });
  try {
    model.updateHistory({ epoch: "epoch", items: [message(1)] });
    model.open();
    model.setQuery("target");
    await expect.poll(() => model.getSnapshot().phase).toBe("ready");
    expect(model.getSnapshot().count).toBe(0);
    model.setOptions({ includeFolded: true, caseSensitive: true });
    await expect.poll(() => model.getSnapshot().count).toBe(1);
    expect(searches.at(-1)).toMatchObject({
      query: "target",
      options: { includeFolded: true, caseSensitive: true },
    });
    expect(reveals.at(-1)).toMatchObject({
      query: "target",
      options: { includeFolded: true, caseSensitive: true },
    });
    model.updateHistory({
      epoch: "epoch",
      items: [message(1)],
      expandedTurnKeys: new Set(["turn"]),
    });
    model.setOptions({ includeFolded: false });
    await expect.poll(() => model.getSnapshot().phase).toBe("ready");
    expect(model.getSnapshot().count).toBe(1);
    model.close();
    expect(model.getSnapshot().options).toEqual({});
    model.open();
    await expect.poll(() => model.getSnapshot().phase).toBe("ready");
    expect(searches.at(-1)?.options).toEqual({});
    expect(model.getSnapshot().count).toBe(1);
  } finally {
    model.close();
  }
});

it("invalidates regex locally without sending a request and recovers when corrected", async () => {
  const searches: ChatFindSearch[] = [];
  const model = new ChatFindModel({
    operations: {
      async search(input) {
        searches.push(input);
        return response([]);
      },
      async load() {},
      async reveal() {
        return { count: 0, occurrence: 0 };
      },
      clear() {},
    },
  });
  try {
    model.open();
    model.setOptions({ regex: true });
    model.setQuery("(");
    expect(model.getSnapshot()).toMatchObject({ phase: "invalid", count: 0 });
    model.next();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(searches).toEqual([]);
    model.setQuery("a+");
    await expect.poll(() => model.getSnapshot().phase).toBe("ready");
    expect(searches).toEqual([{ query: "a+", cursor: undefined, options: { regex: true } }]);
  } finally {
    model.close();
  }
});

it("sends legacy searches without options on an old host", async () => {
  const searches: ChatFindSearch[] = [];
  const model = new ChatFindModel({
    operations: {
      async search(input) {
        searches.push(input);
        return response([]);
      },
      async load() {},
      async reveal() {
        return { count: 0, occurrence: 0 };
      },
      clear() {},
    },
    optionsSupported: false,
  });
  try {
    model.open();
    model.setOptions({ regex: true });
    model.setQuery("(");
    await expect.poll(() => model.getSnapshot().phase).toBe("ready");
    expect(model.getSnapshot().options).toEqual({});
    expect(searches).toEqual([{ query: "(", cursor: undefined, options: undefined }]);
  } finally {
    model.close();
  }
});
