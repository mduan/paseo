/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScrollView } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHorizontalWheelScroll } from "./use-horizontal-wheel-scroll";

vi.stubGlobal("React", React);
afterEach(cleanup);

function TabScroll({ enabled = true }: { enabled?: boolean }) {
  const ref = useHorizontalWheelScroll({ enabled });
  return <ScrollView ref={ref} horizontal testID="tabs" />;
}

function wheel(node: HTMLElement, init: WheelEventInit) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  fireEvent(node, event);
  return event;
}

describe("horizontal wheel scrolling", () => {
  it("scrolls both ways with a vertical wheel and leaves horizontal gestures and zoom alone", () => {
    render(<TabScroll />);
    const node = screen.getByTestId("tabs");
    expect(wheel(node, { deltaY: 80 }).defaultPrevented).toBe(true);
    expect(node.scrollLeft).toBe(80);
    wheel(node, { deltaY: -30 });
    expect(node.scrollLeft).toBe(50);

    expect(wheel(node, { deltaX: 40, deltaY: 5 }).defaultPrevented).toBe(false);
    expect(wheel(node, { deltaY: 20, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(node.scrollLeft).toBe(50);
  });

  it("converts line and page wheel units", () => {
    render(<TabScroll />);
    const node = screen.getByTestId("tabs");
    Object.defineProperty(node, "clientWidth", { value: 300 });
    wheel(node, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(node.scrollLeft).toBe(48);
    wheel(node, { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
    expect(node.scrollLeft).toBe(348);
  });

  it("removes the listener when scrolling is disabled or the view unmounts", () => {
    const { rerender, unmount } = render(<TabScroll />);
    const node = screen.getByTestId("tabs");
    rerender(<TabScroll enabled={false} />);
    expect(wheel(node, { deltaY: 50 }).defaultPrevented).toBe(false);
    expect(node.scrollLeft).toBe(0);

    rerender(<TabScroll />);
    expect(wheel(node, { deltaY: 50 }).defaultPrevented).toBe(true);
    unmount();
    expect(wheel(node, { deltaY: 50 }).defaultPrevented).toBe(false);
    expect(node.scrollLeft).toBe(50);
  });
});
