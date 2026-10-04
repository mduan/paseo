import {
  AppendedLinesReader,
  parseRecordLine,
  readCount,
  toRecord,
} from "../appended-lines-reader.js";
import type { CodexPrices } from "./pricing.js";

/**
 * Sums the estimated cost of every model request recorded in a Codex rollout file.
 *
 * Codex writes each request's token counts and the model of each turn to the rollout, and the file
 * survives compaction, resume, and daemon restarts. Pricing request by request applies the
 * long-context rate and mid-session model switches, which pricing the thread total cannot.
 */
export class CodexRolloutCost {
  private readonly lines: AppendedLinesReader;
  private currentModel: string | undefined;
  private highestTotalTokens = -1;
  private costUsd = 0;
  private pricedRequests = 0;

  constructor(filePath: string) {
    this.lines = new AppendedLinesReader(filePath);
  }

  /** The model of the latest turn read so far. */
  get model(): string | undefined {
    return this.currentModel;
  }

  /**
   * Returns the session cost so far, or undefined when no request used a priced model.
   * ponytail: prices every request at the current service tier; the rollout does not record it.
   */
  async read({
    prices,
    serviceTier,
  }: {
    prices: CodexPrices;
    serviceTier: string | null;
  }): Promise<number | undefined> {
    await this.lines.read((line) => this.applyLine(line, prices, serviceTier));
    return this.pricedRequests > 0 ? this.costUsd : undefined;
  }

  private applyLine(line: string, prices: CodexPrices, serviceTier: string | null): void {
    // Skip the bulk of the rollout (messages, tool output) without parsing it.
    if (!line.includes('"turn_context"') && !line.includes('"token_count"')) return;
    const entry = parseRecordLine(line);
    const payload = toRecord(entry?.payload);
    if (entry?.type === "turn_context") {
      if (typeof payload?.model === "string") this.currentModel = payload.model;
      return;
    }
    if (payload?.type !== "token_count") return;
    const info = toRecord(payload.info);
    const totalTokens = toRecord(info?.total_token_usage)?.total_tokens;
    const last = toRecord(info?.last_token_usage);
    if (typeof totalTokens !== "number" || !last) return;
    // Codex re-emits token_count with an unchanged total, so a request counts only when it grows.
    if (totalTokens <= this.highestTotalTokens) return;
    this.highestTotalTokens = totalTokens;
    const cost = prices.requestCostUsd({
      model: this.currentModel,
      serviceTier,
      inputTokens: readCount(last.input_tokens),
      cachedInputTokens: readCount(last.cached_input_tokens),
      outputTokens: readCount(last.output_tokens),
    });
    if (cost === undefined) return;
    this.costUsd += cost;
    this.pricedRequests += 1;
  }
}
