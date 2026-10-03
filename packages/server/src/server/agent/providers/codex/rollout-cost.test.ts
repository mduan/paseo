import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CodexRolloutCost } from "./rollout-cost.js";

function turnContext(model: string): string {
  return `${JSON.stringify({ type: "turn_context", payload: { model } })}\n`;
}

function tokenCount({
  total,
  input,
  cached = 0,
  output,
}: {
  total: number;
  input: number;
  cached?: number;
  output: number;
}): string {
  return `${JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: total },
        last_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
        },
      },
    },
  })}\n`;
}

describe("CodexRolloutCost", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "codex-rollout-cost-"));
    file = path.join(dir, "rollout.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("prices each request with its turn's model and the long-context rate", async () => {
    writeFileSync(
      file,
      turnContext("gpt-6.1-sol") +
        // 100k uncached × $2/M + 10k output × $10/M = $0.30
        tokenCount({ total: 110_000, input: 100_000, output: 10_000 }) +
        // Long context: 300k uncached × $4/M + 10k output × $15/M = $1.35
        tokenCount({ total: 420_000, input: 300_000, output: 10_000 }) +
        turnContext("gpt-6-luna") +
        // 200k uncached × $0.10/M = $0.02
        tokenCount({ total: 620_000, input: 200_000, output: 0 }),
    );

    expect(await new CodexRolloutCost(file).read("default")).toBeCloseTo(1.67);
  });

  test("ignores re-emitted token counts and reads only appended lines", async () => {
    writeFileSync(
      file,
      turnContext("gpt-6.1-sol") + tokenCount({ total: 1_000, input: 100_000, output: 0 }),
    );
    const cost = new CodexRolloutCost(file);
    expect(await cost.read("default")).toBeCloseTo(0.2);

    // A duplicate total, then a request split mid-line across two writes.
    const next = tokenCount({ total: 2_000, input: 100_000, output: 0 });
    appendFileSync(
      file,
      tokenCount({ total: 1_000, input: 100_000, output: 0 }) + next.slice(0, 20),
    );
    expect(await cost.read("default")).toBeCloseTo(0.2);

    appendFileSync(file, next.slice(20));
    expect(await cost.read("default")).toBeCloseTo(0.4);
  });

  test("returns undefined when no request used a priced model", async () => {
    writeFileSync(
      file,
      turnContext("unknown-model") + tokenCount({ total: 10, input: 10, output: 0 }),
    );

    expect(await new CodexRolloutCost(file).read("default")).toBeUndefined();
  });
});
