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
});
