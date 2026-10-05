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

/** Own cost is always shown; recursive total follows only when native descendants spent money. */
export function formatSubagentCosts({
  ownCostUsd,
  subagentCostUsd,
}: {
  ownCostUsd: number | undefined;
  subagentCostUsd: number | undefined;
}): string[] {
  const own = formatSubagentCost(ownCostUsd);
  if (!own) return [];
  const parts = [`${own} own (est.)`];
  if (typeof subagentCostUsd !== "number" || subagentCostUsd <= 0) return parts;
  const total = formatSubagentCost((ownCostUsd ?? 0) + subagentCostUsd);
  if (total) parts.push(`${total} total (est.)`);
  return parts;
}
