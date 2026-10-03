import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { writeFileAtomic } from "../../../atomic-file.js";
import { resolvePaseoHome } from "../../../paseo-home.js";

// Codex reports tokens but no cost, so Codex costs are priced from LiteLLM's community price list.
// It is the only public source with OpenAI's long-context and priority-tier rates.
const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const MAX_PRICE_LIST_AGE_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

// LiteLLM names long-context rates `*_above_272k_tokens`. A request whose input exceeds this bills
// entirely at that rate.
const LONG_CONTEXT_THRESHOLD_TOKENS = 272_000;
const LONG_CONTEXT_SUFFIX = "_above_272k_tokens";
const PRIORITY_SUFFIX = "_priority";

export interface CodexRequestUsage {
  model: string | undefined;
  serviceTier: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** OpenAI list prices for one model request, keyed by Codex model slug. */
export class CodexPrices {
  constructor(private readonly entries: Record<string, unknown>) {}

  /** Returns undefined for a model missing from the price list. */
  requestCostUsd({
    model,
    serviceTier,
    inputTokens,
    cachedInputTokens,
    outputTokens,
  }: CodexRequestUsage): number | undefined {
    const entry = model ? toRecord(this.entries[model]) : undefined;
    if (!entry) return undefined;
    const tier: RateTier = {
      isLongContext: inputTokens > LONG_CONTEXT_THRESHOLD_TOKENS,
      isPriority: serviceTier === "priority",
    };
    const inputRate = readRate(entry, "input_cost_per_token", tier);
    const outputRate = readRate(entry, "output_cost_per_token", tier);
    if (inputRate === undefined || outputRate === undefined) return undefined;
    const cachedInputRate = readRate(entry, "cache_read_input_token_cost", tier) ?? inputRate;
    // OpenAI counts cached tokens inside input tokens.
    const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
    return (
      uncachedInputTokens * inputRate +
      cachedInputTokens * cachedInputRate +
      outputTokens * outputRate
    );
  }
}

interface RateTier {
  isLongContext: boolean;
  isPriority: boolean;
}

// Prefer the most specific rate LiteLLM lists: a model without a long-context or priority variant
// bills that request at its plain rate.
function readRate(
  entry: Record<string, unknown>,
  field: string,
  tier: RateTier,
): number | undefined {
  const longField = tier.isLongContext ? `${field}${LONG_CONTEXT_SUFFIX}` : field;
  const candidates = [
    tier.isPriority ? `${longField}${PRIORITY_SUFFIX}` : undefined,
    longField,
    tier.isPriority ? `${field}${PRIORITY_SUFFIX}` : undefined,
    field,
  ];
  for (const candidate of candidates) {
    const rate = candidate ? entry[candidate] : undefined;
    if (typeof rate === "number" && Number.isFinite(rate)) return rate;
  }
  return undefined;
}

interface LoadedPrices {
  prices: CodexPrices;
  fetchedAtMs: number;
}

export interface CodexPriceListOptions {
  logger: Logger;
  cacheFile?: string;
  url?: string;
  now?: () => number;
}

/**
 * Loads the price list on first use and saves it under PASEO_HOME. A saved copy younger than a day
 * is used as is. An older or missing copy is fetched again; when that fetch fails the prices are
 * unavailable, not stale, until a retry an hour later succeeds.
 */
export class CodexPriceList {
  private loaded: LoadedPrices | undefined;
  private failedAtMs: number | undefined;
  private inflight: Promise<CodexPrices | undefined> | undefined;
  private readonly cacheFile: string;
  private readonly url: string;
  private readonly now: () => number;

  constructor(private readonly options: CodexPriceListOptions) {
    this.cacheFile =
      options.cacheFile ?? path.join(resolvePaseoHome(), "cache", "litellm-model-prices.json");
    this.url = options.url ?? LITELLM_PRICES_URL;
    this.now = options.now ?? Date.now;
  }

  /** Returns undefined while the price list is unavailable. */
  get(): Promise<CodexPrices | undefined> {
    if (this.loaded && this.isFresh(this.loaded.fetchedAtMs)) {
      return Promise.resolve(this.loaded.prices);
    }
    if (this.failedAtMs !== undefined && this.now() - this.failedAtMs < RETRY_AFTER_FAILURE_MS) {
      return Promise.resolve(undefined);
    }
    this.inflight ??= this.load().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private isFresh(fetchedAtMs: number): boolean {
    return this.now() - fetchedAtMs < MAX_PRICE_LIST_AGE_MS;
  }

  private async load(): Promise<CodexPrices | undefined> {
    this.loaded ??= await this.readSavedCopy();
    if (this.loaded && this.isFresh(this.loaded.fetchedAtMs)) {
      return this.loaded.prices;
    }
    this.loaded = undefined;
    try {
      const response = await fetch(this.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) {
        throw new Error(`Price list request failed with HTTP ${response.status}`);
      }
      const text = await response.text();
      const prices = parsePriceList(text);
      await writeFileAtomic(this.cacheFile, text);
      this.loaded = { prices, fetchedAtMs: this.now() };
      this.failedAtMs = undefined;
      return prices;
    } catch (error) {
      this.failedAtMs = this.now();
      this.options.logger.warn({ error, url: this.url }, "Failed to fetch the Codex price list");
      return undefined;
    }
  }

  private async readSavedCopy(): Promise<LoadedPrices | undefined> {
    try {
      const [text, stat] = await Promise.all([
        fs.readFile(this.cacheFile, "utf8"),
        fs.stat(this.cacheFile),
      ]);
      return { prices: parsePriceList(text), fetchedAtMs: stat.mtimeMs };
    } catch {
      // A missing or corrupt copy is fetched again.
      return undefined;
    }
  }
}

function parsePriceList(text: string): CodexPrices {
  const entries = toRecord(JSON.parse(text));
  if (!entries) {
    throw new Error("Price list is not a JSON object");
  }
  return new CodexPrices(entries);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
