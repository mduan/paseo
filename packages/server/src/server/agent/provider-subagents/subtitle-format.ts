/** Subtitle parts that every provider formats the same way. */

export function formatSubagentTokens(totalTokens: number | undefined): string | undefined {
  if (typeof totalTokens !== "number" || totalTokens <= 0) return undefined;
  if (totalTokens < 1000) return `${Math.round(totalTokens)} tokens`;
  return `${Math.round(totalTokens / 100) / 10}k tokens`;
}

function formatSubagentCost(costUsd: number | undefined): string | undefined {
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0) return undefined;
  const amount = costUsd < 0.01 && costUsd > 0 ? costUsd.toFixed(4) : costUsd.toFixed(2);
  return `$${amount}`;
}

/** Subagent rows show the estimated cost of the subagent and all its native descendants. */
export function formatSubagentCosts({
  ownCostUsd,
  subagentCostUsd,
}: {
  ownCostUsd: number | undefined;
  subagentCostUsd: number | undefined;
}): string[] {
  if (typeof ownCostUsd !== "number") return [];
  const total = formatSubagentCost(ownCostUsd + Math.max(0, subagentCostUsd ?? 0));
  return total ? [`~${total}`] : [];
}
