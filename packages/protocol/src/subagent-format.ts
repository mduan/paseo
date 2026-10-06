/** Formats a subagent's token count the way subagent rows show it, e.g. "174.8k tokens". */
export function formatSubagentTokens(totalTokens: number | undefined): string | undefined {
  if (typeof totalTokens !== "number" || totalTokens <= 0) return undefined;
  if (totalTokens < 1000) return `${Math.round(totalTokens)} tokens`;
  return `${Math.round(totalTokens / 100) / 10}k tokens`;
}
