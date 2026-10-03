interface CodexModelPrice {
  /** USD per million uncached input tokens. */
  input: number;
  /** USD per million cached input tokens. */
  cachedInput: number;
  /** USD per million output tokens, reasoning included. */
  output: number;
  /** Price factor for the priority ("Fast") service tier. */
  priorityMultiplier: number;
  /** Whether requests above LONG_CONTEXT_THRESHOLD_TOKENS input bill at the long-context rate. */
  longContext: boolean;
}

// A request whose input exceeds this bills entirely at the long-context rate: 2x input and cached
// input, 1.5x output.
const LONG_CONTEXT_THRESHOLD_TOKENS = 272_000;
const LONG_CONTEXT_INPUT_MULTIPLIER = 2;
const LONG_CONTEXT_OUTPUT_MULTIPLIER = 1.5;

// OpenAI API list prices from LiteLLM's model_prices_and_context_window.json on 2026-10-02.
// Codex app-server reports tokens but no cost, so update this table by hand when OpenAI changes
// prices or Codex ships a model. Models missing here get no cost estimate.
const CODEX_MODEL_PRICES: Record<string, CodexModelPrice> = {
  "gpt-6.1-sol": {
    input: 2,
    cachedInput: 0.1,
    output: 10,
    priorityMultiplier: 2,
    longContext: true,
  },
  "gpt-6-astra": {
    input: 10,
    cachedInput: 1,
    output: 50,
    priorityMultiplier: 2,
    longContext: true,
  },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10, priorityMultiplier: 2, longContext: true },
  "gpt-6-luna": {
    input: 0.1,
    cachedInput: 0.01,
    output: 0.5,
    priorityMultiplier: 2,
    longContext: true,
  },
  "gpt-5.6-sol": {
    input: 4,
    cachedInput: 0.4,
    output: 20,
    priorityMultiplier: 2,
    longContext: true,
  },
  "gpt-5.6-terra": {
    input: 2,
    cachedInput: 0.2,
    output: 12,
    priorityMultiplier: 2,
    longContext: true,
  },
  "gpt-5.6-luna": {
    input: 0.2,
    cachedInput: 0.02,
    output: 1.2,
    priorityMultiplier: 2,
    longContext: true,
  },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30, priorityMultiplier: 2.5, longContext: true },
  "gpt-5.4": {
    input: 2.5,
    cachedInput: 0.25,
    output: 15,
    priorityMultiplier: 2,
    longContext: true,
  },
  "gpt-5.4-mini": {
    input: 0.75,
    cachedInput: 0.075,
    output: 4.5,
    priorityMultiplier: 2,
    longContext: false,
  },
  "gpt-5.3-codex": {
    input: 1.75,
    cachedInput: 0.175,
    output: 14,
    priorityMultiplier: 2,
    longContext: false,
  },
  "gpt-5.2": {
    input: 1.75,
    cachedInput: 0.175,
    output: 14,
    priorityMultiplier: 2,
    longContext: false,
  },
};

export interface CodexCostInput {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  model: string | undefined;
  serviceTier: string | null;
  /**
   * True when the counts are one model request, so the long-context rate can apply. Summed counts
   * span many requests and always price at the base rate.
   */
  isSingleRequest: boolean;
}

export function estimateCodexCostUsd({
  model,
  serviceTier,
  inputTokens,
  cachedInputTokens,
  outputTokens,
  isSingleRequest,
}: CodexCostInput): number | undefined {
  const price = model ? CODEX_MODEL_PRICES[model] : undefined;
  if (!price) return undefined;
  const tierMultiplier = serviceTier === "priority" ? price.priorityMultiplier : 1;
  const isLongContext =
    isSingleRequest && price.longContext && inputTokens > LONG_CONTEXT_THRESHOLD_TOKENS;
  const inputMultiplier = isLongContext ? LONG_CONTEXT_INPUT_MULTIPLIER : 1;
  const outputMultiplier = isLongContext ? LONG_CONTEXT_OUTPUT_MULTIPLIER : 1;
  // OpenAI counts cached tokens inside input tokens.
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const baseCost =
    (uncachedInputTokens * price.input + cachedInputTokens * price.cachedInput) * inputMultiplier +
    outputTokens * price.output * outputMultiplier;
  return (baseCost * tierMultiplier) / 1_000_000;
}
