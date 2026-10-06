import { describe, expect, it } from "vitest";
import { buildAgentMetaParts } from "./agent-meta";

const SELECTION = {
  activeModelId: "opus",
  displayModel: "Opus 5.5",
  selectedThinkingId: "medium",
  displayThinking: "Medium",
};

describe("buildAgentMetaParts", () => {
  it("builds model, effort, tokens, and combined cost", () => {
    expect(
      buildAgentMetaParts({
        selection: SELECTION,
        usage: { contextWindowUsedTokens: 174_812, totalCostUsd: 2, paseoSubagentCostUsd: 0.33 },
      }),
    ).toEqual({ model: "Opus 5.5", effort: "Medium", tokens: "174.8k tokens", cost: "$2.33" });
  });

  it("leaves out a missing model and effort", () => {
    expect(
      buildAgentMetaParts({
        selection: { ...SELECTION, activeModelId: null, selectedThinkingId: null },
        usage: { totalCostUsd: 1 },
      }),
    ).toEqual({ model: undefined, effort: undefined, tokens: undefined, cost: "$1.00" });
  });

  it("prefixes estimated cost, including an estimated Paseo subtotal", () => {
    expect(
      buildAgentMetaParts({
        selection: SELECTION,
        usage: { totalCostUsd: 1, totalCostEstimated: true },
      }).cost,
    ).toBe("~$1.00");
    expect(
      buildAgentMetaParts({
        selection: SELECTION,
        usage: { paseoSubagentCostUsd: 0.5, paseoSubagentCostEstimated: true },
      }).cost,
    ).toBe("~$0.50");
  });

  it("omits cost when the agent's own cost is unavailable", () => {
    expect(
      buildAgentMetaParts({
        selection: SELECTION,
        usage: { totalCostUnavailable: true, paseoSubagentCostUsd: 0.8 },
      }).cost,
    ).toBeUndefined();
  });

  it("omits tokens and cost without usage", () => {
    const parts = buildAgentMetaParts({ selection: SELECTION, usage: undefined });
    expect(parts.tokens).toBeUndefined();
    expect(parts.cost).toBeUndefined();
  });

  it("formats small token counts without a k suffix", () => {
    expect(
      buildAgentMetaParts({ selection: SELECTION, usage: { contextWindowUsedTokens: 950 } }).tokens,
    ).toBe("950 tokens");
  });
});
