/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useHoverIntent } from "./use-hover-intent";

afterEach(() => vi.useRealTimers());

it("opens immediately, tolerates crossing other rows, and closes after resting elsewhere", () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useHoverIntent());
  act(() => result.current.openNow());
  expect(result.current.open).toBe(true);
  act(() => result.current.scheduleClose());
  act(() => vi.advanceTimersByTime(250));
  expect(result.current.open).toBe(true);
  act(() => result.current.cancelClose());
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.open).toBe(true);
  act(() => result.current.scheduleClose());
  act(() => vi.advanceTimersByTime(299));
  expect(result.current.open).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.open).toBe(false);
  act(() => result.current.openNow());
  act(() => result.current.scheduleClose());
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
