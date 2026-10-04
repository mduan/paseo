import {
  AppendedLinesReader,
  parseRecordLine,
  readCount,
  toRecord,
} from "../../appended-lines-reader.js";
import type { CodexPrices } from "../../codex/pricing.js";

/**
 * Sums the estimated cost of every model request recorded in a Claude subagent transcript.
 *
 * Claude Code reports only a token count per subagent, but its transcript records each request's
 * model and usage split into input, cache writes, cache reads, and output, which is what a price
 * needs. One request can span several entries that share a message id, so each id is priced once,
 * from its latest entry.
 */
export class ClaudeTranscriptCost {
  private readonly lines: AppendedLinesReader;
  private readonly costByMessageId = new Map<string, number>();

  constructor(filePath: string) {
    this.lines = new AppendedLinesReader(filePath);
  }

  /** Returns the cost so far, or undefined when no request used a priced model. */
  async read(prices: CodexPrices): Promise<number | undefined> {
    await this.lines.read((line) => this.applyLine(line, prices));
    if (this.costByMessageId.size === 0) return undefined;
    let total = 0;
    for (const cost of this.costByMessageId.values()) total += cost;
    return total;
  }

  private applyLine(line: string, prices: CodexPrices): void {
    // Skip user entries and tool results without parsing them.
    if (!line.includes('"assistant"') || !line.includes('"usage"')) return;
    const entry = parseRecordLine(line);
    if (entry?.type !== "assistant") return;
    const message = toRecord(entry.message);
    const usage = toRecord(message?.usage);
    if (typeof message?.id !== "string" || !usage) return;
    const cacheWrite = readCount(usage.cache_creation_input_tokens);
    const cacheWrite1h = readCount(toRecord(usage.cache_creation)?.ephemeral_1h_input_tokens);
    const cost = prices.claudeRequestCostUsd({
      model: typeof message.model === "string" ? message.model : undefined,
      inputTokens: readCount(usage.input_tokens),
      cacheWrite5mTokens: Math.max(0, cacheWrite - cacheWrite1h),
      cacheWrite1hTokens: cacheWrite1h,
      cacheReadTokens: readCount(usage.cache_read_input_tokens),
      outputTokens: readCount(usage.output_tokens),
    });
    if (cost !== undefined) this.costByMessageId.set(message.id, cost);
  }
}
