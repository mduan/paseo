import { describe, expect, it } from "vitest";

import { buildClaudeSubagentSubtitle } from "./presentation.js";

describe("buildClaudeSubagentSubtitle", () => {
  it("formats Claude facts into one compact provider-owned label", () => {
    expect(
      buildClaudeSubagentSubtitle({
        title: "general-purpose",
        model: "claude-opus-5",
        effort: "high",
        usage: { totalTokens: 16_484 },
      }),
    ).toBe("general-purpose · Opus 5 · High · 16.5k tokens");
  });

  it("uses the manifest label for dated and context-window model variants", () => {
    expect(buildClaudeSubagentSubtitle({ model: "claude-opus-4-8[1m]" })).toBe("Opus 4.8 1M");
  });

  it("keeps unknown compatible-provider model names visible", () => {
    expect(buildClaudeSubagentSubtitle({ model: "glm-5.1" })).toBe("glm-5.1");
  });

  it("shows own cost and adds recursive total only when descendants have cost", () => {
    expect(
      buildClaudeSubagentSubtitle({
        title: "Explore",
        usage: { totalTokens: 2_000 },
        costUsd: 1.844,
        subagentCostUsd: 0.5,
      }),
    ).toBe("Explore · 2k tokens · $1.84 own (est.) · $2.34 total (est.)");
    expect(buildClaudeSubagentSubtitle({ costUsd: 0.00123 })).toBe("$0.0012 own (est.)");
    expect(buildClaudeSubagentSubtitle({ costUsd: 0, subagentCostUsd: 1 })).toBe(
      "$0.00 own (est.) · $1.00 total (est.)",
    );
  });

  it("omits facts that were not observed", () => {
    expect(buildClaudeSubagentSubtitle({ title: "Explore", usage: { totalTokens: 0 } })).toBe(
      "Explore",
    );
    expect(buildClaudeSubagentSubtitle({})).toBeUndefined();
  });
});
