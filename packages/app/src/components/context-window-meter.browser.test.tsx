import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { page } from "vitest/browser";
import { ReducedMotionConfig, ReduceMotion } from "react-native-reanimated";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContextWindowMeter } from "./context-window-meter";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("React", React);
  container = document.createElement("div");
  container.style.padding = "100px";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows session turns with cost and updates while the usage tooltip is open", async () => {
  function render(turnCount?: number) {
    act(() =>
      root.render(
        <>
          <ReducedMotionConfig mode={ReduceMotion.Always} />
          <ContextWindowMeter
            maxTokens={1000}
            usedTokens={340}
            totalCostUsd={2}
            subagentCostUsd={1}
            turnCount={turnCount}
          />
        </>,
      ),
    );
  }
  render(1);
  await page.getByTestId("context-window-meter").hover();
  const tooltip = page.getByTestId("context-window-meter-tooltip");
  await expect.element(tooltip).toBeVisible();
  await expect.element(tooltip).toHaveTextContent("1 turn");
  await expect.element(tooltip).toHaveTextContent("Own cost: $1.00");
  await expect.element(tooltip).toHaveTextContent("Total cost: $2.00");
  render(2);
  await expect.element(tooltip).toHaveTextContent("2 turns");
  render(0);
  await expect.element(tooltip).toHaveTextContent("0 turns");
  render();
  await expect.element(tooltip).not.toHaveTextContent("turns");
});
