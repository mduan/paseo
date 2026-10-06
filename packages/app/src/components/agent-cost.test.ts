import { describe, expect, it } from "vitest";
import { formatSessionCost, resolveAgentCostBreakdown } from "./agent-cost";

describe("agent cost", () => {
  it("derives own cost and caps a lagging descendant estimate at the current total", () => {
    expect(resolveAgentCostBreakdown({ totalCostUsd: 10, subagentCostUsd: 4 })).toEqual({
      ownCostUsd: 6,
      subagentCostUsd: 4,
      totalCostUsd: 10,
    });
    expect(resolveAgentCostBreakdown({ totalCostUsd: 10, subagentCostUsd: 12 })).toEqual({
      ownCostUsd: 0,
      subagentCostUsd: 10,
      totalCostUsd: 10,
    });
  });

  it("formats a zero own cost when descendants account for the whole total", () => {
    expect(formatSessionCost(0)).toBe("$0.00");
    expect(formatSessionCost(0.00123)).toBe("$0.0012");
  });

  it("folds Paseo children into the total and the subagents' share", () => {
    expect(
      resolveAgentCostBreakdown({ totalCostUsd: 10, subagentCostUsd: 4, paseoSubagentCostUsd: 3 }),
    ).toEqual({ ownCostUsd: 6, subagentCostUsd: 7, totalCostUsd: 13 });
  });

  it("clamps native cost to the provider total before adding Paseo cost", () => {
    expect(
      resolveAgentCostBreakdown({ totalCostUsd: 2, subagentCostUsd: 5, paseoSubagentCostUsd: 1 }),
    ).toEqual({ ownCostUsd: 0, subagentCostUsd: 3, totalCostUsd: 3 });
  });

  it("returns a breakdown from Paseo cost alone when the provider reports none", () => {
    expect(
      resolveAgentCostBreakdown({
        totalCostUsd: undefined,
        subagentCostUsd: undefined,
        paseoSubagentCostUsd: 2,
      }),
    ).toEqual({ ownCostUsd: 0, subagentCostUsd: 2, totalCostUsd: 2 });
    expect(
      resolveAgentCostBreakdown({ totalCostUsd: 0, subagentCostUsd: 0, paseoSubagentCostUsd: 0 }),
    ).toBeNull();
  });

  it("returns nothing when the parent's own cost is unavailable", () => {
    expect(
      resolveAgentCostBreakdown({
        totalCostUsd: 1,
        subagentCostUsd: 0,
        paseoSubagentCostUsd: 2,
        totalCostUnavailable: true,
      }),
    ).toBeNull();
  });
});
