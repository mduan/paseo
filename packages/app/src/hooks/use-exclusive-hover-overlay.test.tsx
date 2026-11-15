import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HoverOverlayParentProvider,
  useExclusiveHoverOverlay,
} from "@/hooks/use-exclusive-hover-overlay";

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function HoverOverlayNode({
  testId,
  initialOpen = false,
  children,
}: {
  testId: string;
  initialOpen?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(initialOpen);
  const handleClose = React.useCallback(() => {
    setOpen(false);
  }, []);
  const { overlayId, claim } = useExclusiveHoverOverlay({
    open,
    onClose: handleClose,
  });
  const handleOpen = React.useCallback(() => {
    claim();
    setOpen(true);
  }, [claim]);

  return (
    <div>
      <button data-testid={`${testId}-open`} onClick={handleOpen} type="button">
        Open
      </button>
      {open ? (
        <HoverOverlayParentProvider value={overlayId}>
          <div data-testid={`${testId}-content`}>{children}</div>
        </HoverOverlayParentProvider>
      ) : null}
    </div>
  );
}

function click(testId: string): void {
  const el = container?.querySelector(`[data-testid="${testId}"]`);
  expect(el).not.toBeNull();
  act(() => {
    el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

function isVisible(testId: string): boolean {
  return container?.querySelector(`[data-testid="${testId}"]`) !== null;
}

describe("useExclusiveHoverOverlay", () => {
  it("closes an open top-level overlay when another top-level overlay opens", () => {
    act(() => {
      root?.render(
        <>
          <HoverOverlayNode testId="card-a" />
          <HoverOverlayNode testId="card-b" />
        </>,
      );
    });

    click("card-a-open");
    expect(isVisible("card-a-content")).toBe(true);
    expect(isVisible("card-b-content")).toBe(false);

    click("card-b-open");
    expect(isVisible("card-a-content")).toBe(false);
    expect(isVisible("card-b-content")).toBe(true);
  });

  it("keeps a parent overlay open when a nested tooltip opens, and closes sibling nested tooltips", () => {
    act(() => {
      root?.render(
        <>
          <HoverOverlayNode testId="card-a">
            <HoverOverlayNode testId="nested-1" />
            <HoverOverlayNode testId="nested-2" />
          </HoverOverlayNode>
          <HoverOverlayNode testId="card-b" />
        </>,
      );
    });

    click("card-a-open");
    click("nested-1-open");
    expect(isVisible("card-a-content")).toBe(true);
    expect(isVisible("nested-1-content")).toBe(true);

    click("nested-2-open");
    expect(isVisible("card-a-content")).toBe(true);
    expect(isVisible("nested-1-content")).toBe(false);
    expect(isVisible("nested-2-content")).toBe(true);

    click("card-b-open");
    expect(isVisible("card-a-content")).toBe(false);
    expect(isVisible("nested-2-content")).toBe(false);
    expect(isVisible("card-b-content")).toBe(true);
  });
});
