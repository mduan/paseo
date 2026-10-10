import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedComposerMessage } from "./actions";
import { QueuedMessageList } from "./queued-message-list";

const messages: QueuedComposerMessage[] = [
  { id: "first", text: "First queued message", attachments: [] },
  { id: "second", text: "Second queued message", attachments: [] },
  { id: "third", text: "Third queued message", attachments: [] },
];

let root: Root;
let container: HTMLDivElement;
const onReorder = vi.fn();
const onEdit = vi.fn();
const onSendNow = vi.fn();

function render(queuedMessages = messages) {
  act(() => {
    root.render(
      <QueuedMessageList
        queuedMessages={queuedMessages}
        onReorder={onReorder}
        onEdit={onEdit}
        onSendNow={onSendNow}
        editLabel="Edit queued message"
        reorderLabel="Reorder queued message"
        sendNowLabel="Send queued message now"
      />,
    );
  });
}

function startMouseDrag(index: number) {
  const handle = page.getByRole("button", { name: "Reorder queued message" }).nth(index).element();
  const rect = handle.getBoundingClientRect();
  const clientX = rect.x + rect.width / 2;
  const clientY = rect.y + rect.height / 2;
  act(() =>
    handle.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0, clientX, clientY }),
    ),
  );
  act(() =>
    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, buttons: 1, clientX, clientY: clientY + 10 }),
    ),
  );
}

function moveMouseTo(index: number) {
  const handle = page.getByRole("button", { name: "Reorder queued message" }).nth(index).element();
  const rect = handle.getBoundingClientRect();
  act(() =>
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        buttons: 1,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      }),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  container.style.width = "600px";
  container.style.maxWidth = "100%";
  document.body.appendChild(container);
  root = createRoot(container);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("queued message reordering", () => {
  it("reorders from the handle with the keyboard", async () => {
    await act(async () => {
      await userEvent.click(page.getByRole("button", { name: "Reorder queued message" }).nth(0));
      await userEvent.keyboard("[Space]");
    });
    await expect
      .element(page.getByRole("button", { name: "Reorder queued message" }).nth(0))
      .toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      await userEvent.keyboard("[ArrowDown]");
    });
    await act(async () => {
      await userEvent.keyboard("[Space]");
    });

    await expect
      .poll(() => onReorder.mock.calls[0]?.[0])
      .toEqual([messages[1], messages[0], messages[2]]);
  });

  it("reorders from the handle with the mouse", async () => {
    startMouseDrag(0);
    moveMouseTo(2);
    act(() => document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));
    await expect
      .poll(() => onReorder.mock.calls[0]?.[0])
      .toEqual([messages[1], messages[2], messages[0]]);
  });

  it("cancels a mouse drag when another queued message is sent", () => {
    startMouseDrag(1);
    moveMouseTo(2);
    expect(container.querySelector('[aria-pressed="true"]')).not.toBeNull();

    render(messages.slice(1));

    expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
    act(() => document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it.each(messages.slice(0, 2))("cancels the active drag when $id is sent", async (sentMessage) => {
    await act(async () => {
      await userEvent.click(page.getByRole("button", { name: "Reorder queued message" }).nth(1));
      await userEvent.keyboard("[Space]");
    });
    await act(async () => {
      await userEvent.keyboard("[ArrowDown]");
    });
    await expect
      .element(page.getByRole("button", { name: "Reorder queued message" }).nth(1))
      .toHaveAttribute("aria-pressed", "true");

    render(messages.filter((message) => message.id !== sentMessage.id));

    await expect
      .element(page.getByRole("button", { name: "Reorder queued message" }).nth(0))
      .not.toHaveAttribute("aria-pressed", "true");
    await expect
      .element(page.getByRole("button", { name: "Reorder queued message" }).nth(1))
      .not.toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      await userEvent.keyboard("[Space]");
    });
    expect(onReorder).not.toHaveBeenCalled();
    await expect.element(page.getByText(sentMessage.text)).not.toBeInTheDocument();
  });

  it("keeps edit and send-now separate from the drag handle", async () => {
    await act(async () => {
      await userEvent.click(page.getByRole("button", { name: "Edit queued message" }).nth(1));
      await userEvent.click(page.getByRole("button", { name: "Send queued message now" }).nth(1));
    });

    expect(onEdit).toHaveBeenCalledWith("second");
    expect(onSendNow).toHaveBeenCalledWith("second");
    expect(onReorder).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole("button", { name: "Move queued message to front" }))
      .not.toBeInTheDocument();
  });
});
