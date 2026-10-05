import { describe, expect, it } from "vitest";
import { rollupProviderSubagentCosts } from "./cost.js";

describe("rollupProviderSubagentCosts", () => {
  it("attributes every descendant to each native ancestor exactly once", () => {
    const costs = rollupProviderSubagentCosts([
      { id: "child", parentSubagentId: null, ownCostUsd: 1 },
      { id: "grandchild", parentSubagentId: "child", ownCostUsd: 2 },
      { id: "great-grandchild", parentSubagentId: "grandchild", ownCostUsd: 4 },
      { id: "sibling", parentSubagentId: null, ownCostUsd: 8 },
    ]);

    expect(costs.totalCostUsd).toBe(15);
    expect(costs.byId.get("child")).toEqual({
      ownCostUsd: 1,
      subagentCostUsd: 6,
      totalCostUsd: 7,
    });
    expect(costs.byId.get("grandchild")).toEqual({
      ownCostUsd: 2,
      subagentCostUsd: 4,
      totalCostUsd: 6,
    });
    expect(costs.byId.get("great-grandchild")).toEqual({
      ownCostUsd: 4,
      subagentCostUsd: 0,
      totalCostUsd: 4,
    });
    expect(costs.byId.get("sibling")).toEqual({
      ownCostUsd: 8,
      subagentCostUsd: 0,
      totalCostUsd: 8,
    });
  });

  it("does not loop or attribute a node to itself when provider ownership is cyclic", () => {
    const costs = rollupProviderSubagentCosts([
      { id: "a", parentSubagentId: "b", ownCostUsd: 1 },
      { id: "b", parentSubagentId: "a", ownCostUsd: 2 },
    ]);

    expect(costs.byId.get("a")?.subagentCostUsd).toBe(2);
    expect(costs.byId.get("b")?.subagentCostUsd).toBe(1);
  });
});
