interface CodexModelPrice {
  /** USD per million uncached input tokens. */
  input: number;
  /** USD per million cached input tokens. */
  cachedInput: number;
  /** USD per million output tokens, reasoning included. */
  output: number;
  /** Price factor for the priority ("Fast") service tier. */
  priorityMultiplier: number;
}

// OpenAI API list prices from LiteLLM's model_prices_and_context_window.json on 2026-10-02.
// Codex app-server reports tokens but no cost, so update this table by hand when OpenAI changes
// prices or Codex ships a model. Models missing here get no cost estimate.
// ponytail: ignores the long-context rate above 272k input tokens, so huge prompts underestimate.
const CODEX_MODEL_PRICES: Record<string, CodexModelPrice> = {
  "gpt-6.1-sol": { input: 2, cachedInput: 0.1, output: 10, priorityMultiplier: 2 },
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50, priorityMultiplier: 2 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10, priorityMultiplier: 2 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5, priorityMultiplier: 2 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20, priorityMultiplier: 2 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12, priorityMultiplier: 2 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2, priorityMultiplier: 2 },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30, priorityMultiplier: 2.5 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15, priorityMultiplier: 2 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5, priorityMultiplier: 2 },
  "gpt-5.3-codex": { input: 1.75, cachedInput: 0.175, output: 14, priorityMultiplier: 2 },
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14, priorityMultiplier: 2 },
};

export interface CodexCostInput {
  model: string | undefined;
  serviceTier: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

// ponytail: prices the whole thread at the current model and tier; a mid-session switch reprices
// earlier turns. Track per-turn deltas if mixed-model sessions need exact totals.
export function estimateCodexCostUsd({
  model,
  serviceTier,
  inputTokens,
  cachedInputTokens,
  outputTokens,
}: CodexCostInput): number | undefined {
  const price = model ? CODEX_MODEL_PRICES[model] : undefined;
  if (!price) return undefined;
  const multiplier = serviceTier === "priority" ? price.priorityMultiplier : 1;
  // OpenAI counts cached tokens inside input tokens.
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const baseCost =
    uncachedInputTokens * price.input +
    cachedInputTokens * price.cachedInput +
    outputTokens * price.output;
  return (baseCost * multiplier) / 1_000_000;
}
