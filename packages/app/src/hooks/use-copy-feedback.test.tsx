/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCopyFeedback } from "./use-copy-feedback";

afterEach(() => vi.useRealTimers());

it("shows copied feedback for two seconds", () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useCopyFeedback());
  expect(result.current.copied).toBe(false);
  act(() => result.current.markCopied());
  expect(result.current.copied).toBe(true);
  act(() => vi.advanceTimersByTime(1999));
  expect(result.current.copied).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.copied).toBe(false);
  unmount();
});

it("restarts the feedback duration on another copy and clears its timer on unmount", () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useCopyFeedback());
  act(() => result.current.markCopied());
  act(() => vi.advanceTimersByTime(1500));
  act(() => result.current.markCopied());
  act(() => vi.advanceTimersByTime(1500));
  expect(result.current.copied).toBe(true);
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.copied).toBe(false);
  act(() => result.current.markCopied());
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
