import { afterEach, describe, expect, it, vi } from "vitest";
import { formatAmount, formatResetLabel, formatResetTooltip } from "./format";

describe("formatAmount", () => {
  it("groups thousands in the app's language", () => {
    expect(formatAmount(12345, "credits", "en")).toBe("12,345");
    expect(formatAmount(12345, "requests", "en")).toBe("12,345");
    expect(formatAmount(12345, "credits", "fr").replace(/\s/g, " ")).toBe("12 345");
  });

  it("formats dollars as the language writes currency", () => {
    expect(formatAmount(1234.5, "usd", "en")).toBe("$1,234.50");
    expect(formatAmount(1234.5, "usd", "fr").replace(/\s/g, " ")).toBe("1 234,50 $US");
  });
});

describe("formatResetLabel", () => {
  afterEach(() => vi.useRealTimers());
  it.each([
    [undefined, null],
    ["invalid", null],
    ["2026-11-14T11:00:00Z", "resetting now"],
    ["2026-11-14T12:45:00Z", "resets 45m"],
    ["2026-11-14T13:00:00Z", "resets 1h"],
    ["2026-11-14T13:40:00Z", "resets 1h 40m"],
    ["2026-11-19T14:00:00Z", "resets 5d 2h"],
    ["2026-11-20T12:00:00Z", "resets 6d"],
  ])("formats %s as %s", (iso, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
    expect(formatResetLabel(iso)).toBe(expected);
  });
});

describe("formatResetTooltip", () => {
  afterEach(() => vi.useRealTimers());
  it.each([
    [undefined, null],
    ["invalid", null],
    ["2026-11-14T11:00:00Z", "Resetting now"],
    ["2026-11-14T12:45:00Z", "Resets in 45m"],
    ["2026-11-14T13:00:00Z", "Resets in 1h"],
    ["2026-11-14T13:40:00Z", "Resets in 1h 40m"],
    ["2026-11-15T13:00:00Z", "Resets in 1d 1h"],
    ["2026-11-19T14:00:00Z", "Resets in 5d 2h"],
    ["2026-11-20T12:00:00Z", "Resets in 6d"],
  ])("formats %s as %s", (iso, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
    expect(formatResetTooltip(iso)).toBe(expected);
  });
});
