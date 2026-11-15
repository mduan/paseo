import { afterEach, describe, expect, it, vi } from "vitest";
import { formatAmount, formatResetTooltip } from "./format";

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

describe("formatResetTooltip", () => {
  afterEach(() => vi.useRealTimers());
  it.each([
    [undefined, null],
    ["invalid", null],
    ["2026-11-14T11:00:00Z", "Resetting now"],
    ["2026-11-14T12:45:00Z", "Resets in 45 minutes"],
    ["2026-11-14T13:00:00Z", "Resets in 1 hour"],
    ["2026-11-20T12:00:00Z", "Resets in 6 days"],
  ])("formats %s as %s", (iso, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
    expect(formatResetTooltip(iso)).toBe(expected);
  });
});
