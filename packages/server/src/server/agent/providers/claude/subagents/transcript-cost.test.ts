import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CodexPrices } from "../../codex/pricing.js";
import { ClaudeTranscriptCost } from "./transcript-cost.js";

// LiteLLM rates in USD per token.
const prices = new CodexPrices({
  "claude-opus-5-5": {
    input_cost_per_token: 4e-6,
    cache_creation_input_token_cost: 5e-6,
    cache_creation_input_token_cost_above_1hr: 8e-6,
    cache_read_input_token_cost: 2e-7,
    output_cost_per_token: 2e-5,
  },
});

function assistant({
  id,
  model = "claude-opus-5-5",
  usage,
}: {
  id: string;
  model?: string;
  usage: Record<string, unknown>;
}): string {
  return `${JSON.stringify({ type: "assistant", message: { id, model, usage } })}\n`;
}

describe("ClaudeTranscriptCost", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "claude-transcript-cost-"));
    file = path.join(dir, "agent-task.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("prices a request once when Claude Code splits it across entries", async () => {
    writeFileSync(
      file,
      assistant({ id: "msg-1", usage: { input_tokens: 1_000, output_tokens: 10 } }) +
        // The same request's final entry: 1k × $4/M + 1k × $20/M = $0.024
        assistant({ id: "msg-1", usage: { input_tokens: 1_000, output_tokens: 1_000 } }) +
        `${JSON.stringify({ type: "user", message: { content: "tool result" } })}\n`,
    );

    expect(await new ClaudeTranscriptCost(file).read(prices)).toBeCloseTo(0.024);
  });

  test("prices one-hour cache writes at their own rate", async () => {
    writeFileSync(
      file,
      assistant({
        id: "msg-1",
        // 10k 5m writes × $5/M + 10k 1h writes × $8/M + 100k reads × $0.20/M = $0.15
        usage: {
          cache_creation_input_tokens: 20_000,
          cache_creation: { ephemeral_5m_input_tokens: 10_000, ephemeral_1h_input_tokens: 10_000 },
          cache_read_input_tokens: 100_000,
        },
      }),
    );

    expect(await new ClaudeTranscriptCost(file).read(prices)).toBeCloseTo(0.15);
  });

  test("adds requests appended after the previous read", async () => {
    const cost = new ClaudeTranscriptCost(file);
    writeFileSync(file, assistant({ id: "msg-1", usage: { output_tokens: 1_000 } }));
    expect(await cost.read(prices)).toBeCloseTo(0.02);

    appendFileSync(file, assistant({ id: "msg-2", usage: { output_tokens: 2_000 } }));
    expect(await cost.read(prices)).toBeCloseTo(0.06);
  });

  test("has no estimate when no request used a priced model", async () => {
    writeFileSync(
      file,
      assistant({ id: "msg-1", model: "<synthetic>", usage: { output_tokens: 1_000 } }),
    );

    expect(await new ClaudeTranscriptCost(file).read(prices)).toBeUndefined();
  });
});
