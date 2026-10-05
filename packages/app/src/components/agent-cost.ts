export interface AgentCostBreakdown {
  ownCostUsd: number;
  subagentCostUsd: number;
  totalCostUsd: number;
}

export function formatSessionCost(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 0.01 && value > 0) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function resolveAgentCostBreakdown({
  totalCostUsd,
  subagentCostUsd,
}: {
  totalCostUsd: number | null | undefined;
  subagentCostUsd: number | null | undefined;
}): AgentCostBreakdown | null {
  if (typeof totalCostUsd !== "number" || !Number.isFinite(totalCostUsd) || totalCostUsd <= 0) {
    return null;
  }
  const validSubagentCost =
    typeof subagentCostUsd === "number" && Number.isFinite(subagentCostUsd)
      ? Math.max(0, Math.min(subagentCostUsd, totalCostUsd))
      : 0;
  return {
    ownCostUsd: totalCostUsd - validSubagentCost,
    subagentCostUsd: validSubagentCost,
    totalCostUsd,
  };
}
