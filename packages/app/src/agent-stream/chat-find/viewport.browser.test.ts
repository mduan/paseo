import { afterEach, expect, it } from "vitest";
import { createFindViewport } from "./viewport.web";
import type { ChatFindProps } from "./types";
import type { StreamViewportHandle } from "../strategy";

interface Capture {
  occurrence?: { signal: AbortSignal; targetTop(): number | null };
}

function transcript(messageId: string, blocks: string[]): HTMLElement {
  const root = document.createElement("div");
  for (const [index, text] of blocks.entries()) {
    const row = document.createElement("div");
    row.setAttribute("data-history-row-id", `${messageId}:block:${index}`);
    row.setAttribute("data-message-id", messageId);
    row.innerHTML = `<div data-message-text="true"><div data-paseo-markdown-tag="p">${text}</div></div>`;
    root.append(row);
  }
  document.body.append(root);
  return root;
}

function viewport(root: HTMLElement, capture: Capture) {
  const handle: StreamViewportHandle = {
    scrollToBottom() {},
    prepareForViewportChange() {},
    scrollToMessage(_messageId, occurrence) {
      if (occurrence) capture.occurrence = occurrence;
    },
  };
  const bindings: Pick<
    ChatFindProps,
    "viewportRef" | "revealLoadedMessage" | "visibleMessageIds" | "items" | "expandTurn"
  > = {
    items: [],
    expandTurn() {},
    viewportRef: { current: handle },
    revealLoadedMessage: () => false,
    visibleMessageIds: new Set(["message-1"]),
  };
  return createFindViewport({
    getBindings: () => bindings,
    getRoot: () => root,
    highlightName: "paseo-chat-find-test",
  });
}

afterEach(() => {
  CSS.highlights.delete("paseo-chat-find-test");
  document.body.replaceChildren();
});

it("counts occurrences across every block row of the message", async () => {
  const root = transcript("message-1", ["needle one needle", "no hits", "needle three"]);
  const capture: Capture = {};
  const found = await viewport(root, capture).reveal({
    messageId: "message-1",
    query: "needle",
    options: {},
    occurrence: 2,
    signal: new AbortController().signal,
  });
  expect(found).toEqual({ occurrence: 2, count: 3 });
});

// The settle loop asks for the target position every frame while the viewport moves,
// and rows mount and unmount as it does. A flat index into the message would name a
// different occurrence each time the row set changed; the chosen row owns it instead.
it("keeps the chosen occurrence when an earlier row unmounts mid-scroll", async () => {
  const root = transcript("message-1", ["needle one needle", "needle three"]);
  const capture: Capture = {};
  const found = await viewport(root, capture).reveal({
    messageId: "message-1",
    query: "needle",
    options: {},
    occurrence: 2,
    signal: new AbortController().signal,
  });
  expect(found).toEqual({ occurrence: 2, count: 3 });

  const settled = capture.occurrence?.targetTop();
  expect(settled).toBeTypeOf("number");
  expect(highlightedText()).toEqual(["needle"]);
  expect(highlightedRow()).toBe("message-1:block:1");

  root.firstElementChild?.remove();
  expect(capture.occurrence?.targetTop()).toBeTypeOf("number");
  expect(highlightedRow()).toBe("message-1:block:1");
});

function highlightedRanges(): Range[] {
  const highlight = CSS.highlights.get("paseo-chat-find-test");
  return highlight ? Array.from(highlight).filter((range) => range instanceof Range) : [];
}

function highlightedText(): string[] {
  return highlightedRanges().map((range) => range.toString());
}

function highlightedRow(): string | undefined {
  const row =
    highlightedRanges()[0]?.startContainer.parentElement?.closest<HTMLElement>(
      "[data-history-row-id]",
    );
  return row?.dataset.historyRowId;
}

it("expands folded work before revealing its history window and highlighting", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const calls: string[] = [];
  const items: ChatFindProps["items"] = [
    { kind: "user_message", id: "prompt", turnId: "turn", text: "Prompt", timestamp: new Date(0) },
    {
      kind: "assistant_message",
      id: "work",
      turnId: "turn",
      text: "Hidden NEEDLE",
      timestamp: new Date(1),
    },
    {
      kind: "assistant_message",
      id: "final",
      turnId: "turn",
      text: "Done",
      timestamp: new Date(2),
    },
  ];
  const visibleMessageIds = new Set<string>();
  const handle: StreamViewportHandle = {
    scrollToBottom() {},
    prepareForViewportChange() {},
    scrollToMessage() {
      calls.push("scroll");
    },
  };
  const find = createFindViewport({
    getRoot: () => root,
    highlightName: "paseo-chat-find-test",
    getBindings: () => ({
      items,
      visibleMessageIds,
      viewportRef: { current: handle },
      expandTurn(turnKey) {
        calls.push(`expand:${turnKey}`);
      },
      revealLoadedMessage() {
        calls.push("history");
        const row = transcript("work", ["Hidden NEEDLE"]);
        root.append(...row.childNodes);
        row.remove();
        visibleMessageIds.add("work");
        return true;
      },
    }),
  });
  expect(
    await find.reveal({
      messageId: "work",
      query: "N[A-Z]+",
      options: { regex: true, caseSensitive: true },
      occurrence: 0,
      signal: new AbortController().signal,
    }),
  ).toEqual({ count: 1, occurrence: 0 });
  expect(calls).toEqual(["expand:turn", "history", "scroll"]);
  expect(highlightedText()).toEqual(["NEEDLE"]);
});
