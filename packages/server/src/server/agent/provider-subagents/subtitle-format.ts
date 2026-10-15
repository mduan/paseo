export function buildSubagentSubtitle({
  context,
  usage,
}: {
  context: readonly (string | undefined)[];
  usage: readonly (string | undefined)[];
}) {
  const contextText = context.filter(Boolean).join(" · ");
  const usageText = usage.filter(Boolean).join(" · ");
  const subtitle = [contextText, usageText].filter(Boolean).join(" · ");
  return subtitle
    ? { subtitle, subtitleParts: { context: contextText, usage: usageText } }
    : undefined;
}

export type ProviderSubagentSubtitle = NonNullable<ReturnType<typeof buildSubagentSubtitle>>;

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
