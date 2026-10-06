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

function nonNegativeCost(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * The provider session total plus the Paseo children's subtotal. "Subagents" covers both
 * provider-native and Paseo children; own cost excludes both.
 */
export function resolveAgentCostBreakdown({
  totalCostUsd,
  subagentCostUsd,
  paseoSubagentCostUsd,
  totalCostUnavailable,
}: {
  totalCostUsd: number | null | undefined;
  subagentCostUsd: number | null | undefined;
  paseoSubagentCostUsd?: number | null;
  totalCostUnavailable?: boolean;
}): AgentCostBreakdown | null {
  if (totalCostUnavailable) return null;
  const providerTotal = nonNegativeCost(totalCostUsd);
  const paseoCost = nonNegativeCost(paseoSubagentCostUsd);
  const total = providerTotal + paseoCost;
  if (total <= 0) return null;
  const nativeCost = Math.min(nonNegativeCost(subagentCostUsd), providerTotal);
  return {
    ownCostUsd: providerTotal - nativeCost,
    subagentCostUsd: nativeCost + paseoCost,
    totalCostUsd: total,
  };
}
