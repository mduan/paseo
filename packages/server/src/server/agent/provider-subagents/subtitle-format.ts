/** Subtitle parts that every provider formats the same way. */

export function formatSubagentTokens(totalTokens: number | undefined): string | undefined {
  if (typeof totalTokens !== "number" || totalTokens <= 0) return undefined;
  if (totalTokens < 1000) return `${Math.round(totalTokens)} tokens`;
  return `${Math.round(totalTokens / 100) / 10}k tokens`;
}

/** Rounded like the app's session cost, and marked as an estimate from list prices. */
export function formatSubagentCost(costUsd: number | undefined): string | undefined {
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd <= 0) return undefined;
  const amount = costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2);
  return `$${amount} (est.)`;
}
