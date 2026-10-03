import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { CodexPriceList, CodexPrices } from "./pricing.js";

const HOUR_MS = 60 * 60 * 1000;

// LiteLLM rates in USD per token.
const PRICE_LIST = {
  "gpt-6.1-sol": {
    input_cost_per_token: 2e-6,
    cache_read_input_token_cost: 1e-7,
    output_cost_per_token: 1e-5,
    input_cost_per_token_priority: 4e-6,
    cache_read_input_token_cost_priority: 2e-7,
    output_cost_per_token_priority: 2e-5,
    input_cost_per_token_above_272k_tokens: 4e-6,
    cache_read_input_token_cost_above_272k_tokens: 2e-7,
    output_cost_per_token_above_272k_tokens: 1.5e-5,
  },
};

describe("CodexPrices", () => {
  const prices = new CodexPrices(PRICE_LIST);
  const request = {
    model: "gpt-6.1-sol",
    inputTokens: 100_000,
    cachedInputTokens: 40_000,
    outputTokens: 10_000,
  };

  test("prices uncached input, cached input, and output separately", () => {
    // 60k × $2/M + 40k × $0.10/M + 10k × $10/M = $0.224
    expect(prices.requestCostUsd({ ...request, serviceTier: "default" })).toBeCloseTo(0.224);
  });

  test("uses the priority rate for the Fast tier", () => {
    expect(prices.requestCostUsd({ ...request, serviceTier: "priority" })).toBeCloseTo(0.448);
  });

  test("bills a request above 272k input tokens entirely at the long-context rate", () => {
    // 300k × $4/M + 10k × $15/M = $1.35
    expect(
      prices.requestCostUsd({
        ...request,
        serviceTier: "default",
        inputTokens: 300_000,
        cachedInputTokens: 0,
      }),
    ).toBeCloseTo(1.35);
  });

  test("falls back to the long-context rate when no priority long-context rate is listed", () => {
    expect(
      prices.requestCostUsd({
        ...request,
        serviceTier: "priority",
        inputTokens: 300_000,
        cachedInputTokens: 0,
      }),
    ).toBeCloseTo(1.35);
  });

  test("has no price for a model missing from the list", () => {
    expect(
      prices.requestCostUsd({ ...request, model: "unknown-model", serviceTier: "default" }),
    ).toBeUndefined();
  });
});

describe("CodexPriceList", () => {
  let dir: string;
  let cacheFile: string;
  let server: Server;
  let url: string;
  let requests: number;
  let respondWith: { status: number; body: string };
  let nowMs: number;

  function createPriceList(): CodexPriceList {
    return new CodexPriceList({ logger: createTestLogger(), cacheFile, url, now: () => nowMs });
  }

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "codex-price-list-"));
    cacheFile = path.join(dir, "cache", "prices.json");
    requests = 0;
    respondWith = { status: 200, body: JSON.stringify(PRICE_LIST) };
    nowMs = Date.now();
    server = createServer((_req, res) => {
      requests += 1;
      res.writeHead(respondWith.status).end(respondWith.body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/prices.json`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  test("fetches once on first use, shares the request, and saves the list", async () => {
    const priceList = createPriceList();

    const [first, second] = await Promise.all([priceList.get(), priceList.get()]);
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(CodexPrices);
    expect(await priceList.get()).toBe(first);
    expect(requests).toBe(1);

    // A new daemon reuses the saved copy without fetching.
    expect(await createPriceList().get()).toBeInstanceOf(CodexPrices);
    expect(requests).toBe(1);
  });

  test("reports prices unavailable when a due fetch fails, without using the stale copy", async () => {
    // Save a copy, then let it go stale.
    await createPriceList().get();
    respondWith = { status: 500, body: "" };
    nowMs += 25 * HOUR_MS;
    const priceList = createPriceList();

    expect(await priceList.get()).toBeUndefined();
    expect(requests).toBe(2);

    // Within the retry window no request is made.
    nowMs += HOUR_MS / 2;
    expect(await priceList.get()).toBeUndefined();
    expect(requests).toBe(2);

    respondWith = { status: 200, body: JSON.stringify(PRICE_LIST) };
    nowMs += HOUR_MS;
    expect(await priceList.get()).toBeInstanceOf(CodexPrices);
    expect(requests).toBe(3);
  });
});
