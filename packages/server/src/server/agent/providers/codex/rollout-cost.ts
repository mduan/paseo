import fs from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import type { CodexPrices } from "./pricing.js";

/**
 * Sums the estimated cost of every model request recorded in a Codex rollout file.
 *
 * Codex writes each request's token counts and the model of each turn to the rollout, and the file
 * survives compaction, resume, and daemon restarts. Pricing request by request applies the
 * long-context rate and mid-session model switches, which pricing the thread total cannot.
 * Each read parses only the bytes appended since the previous read.
 */
export class CodexRolloutCost {
  private offset = 0;
  private readonly decoder = new StringDecoder("utf8");
  private pendingLine = "";
  private model: string | undefined;
  private highestTotalTokens = -1;
  private costUsd = 0;
  private pricedRequests = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /**
   * Returns the session cost so far, or undefined when no request used a priced model.
   * ponytail: prices every request at the current service tier; the rollout does not record it.
   */
  read({
    prices,
    serviceTier,
  }: {
    prices: CodexPrices;
    serviceTier: string | null;
  }): Promise<number | undefined> {
    const result = this.queue.then(() => this.readAppended(prices, serviceTier));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async readAppended(
    prices: CodexPrices,
    serviceTier: string | null,
  ): Promise<number | undefined> {
    const handle = await fs.open(this.filePath, "r");
    try {
      const { size } = await handle.stat();
      if (size > this.offset) {
        const buffer = Buffer.alloc(size - this.offset);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
        this.offset += bytesRead;
        const lines = (this.pendingLine + this.decoder.write(buffer.subarray(0, bytesRead))).split(
          "\n",
        );
        this.pendingLine = lines.pop() ?? "";
        for (const line of lines) {
          this.applyLine(line, prices, serviceTier);
        }
      }
    } finally {
      await handle.close();
    }
    return this.pricedRequests > 0 ? this.costUsd : undefined;
  }

  private applyLine(line: string, prices: CodexPrices, serviceTier: string | null): void {
    // Skip the bulk of the rollout (messages, tool output) without parsing it.
    if (!line.includes('"turn_context"') && !line.includes('"token_count"')) return;
    const entry = parseRecord(line);
    const payload = toRecord(entry?.payload);
    if (entry?.type === "turn_context") {
      if (typeof payload?.model === "string") this.model = payload.model;
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
      model: this.model,
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

function parseRecord(line: string): Record<string, unknown> | undefined {
  try {
    return toRecord(JSON.parse(line));
  } catch {
    // A torn or foreign line only drops that line from an estimate.
    return undefined;
  }
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
