/**
 * @vitest-environment jsdom
 */
import React from "react";
import { Text } from "react-native";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LargeDiffGate } from "./diff-too-large-state";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(cleanup);

const REFS = { from: { name: "origin/main" }, to: { name: "feature", sha: "5c7da5b1234" } };
const onShowDiff = vi.fn();
const largeFiles = Array.from({ length: 301 }, () => ({ additions: 1, deletions: 0 }));

function renderGate(input: { files: typeof largeFiles; comparisonKey: string }) {
  return (
    <LargeDiffGate
      files={input.files}
      comparisonKey={input.comparisonKey}
      refs={REFS}
      onShowDiff={onShowDiff}
    >
      <Text testID="diff">diff</Text>
    </LargeDiffGate>
  );
}
describe("LargeDiffGate", () => {
  it("renders an ordinary diff directly", () => {
    const view = render(renderGate({ files: largeFiles.slice(0, 3), comparisonKey: "a" }));
    expect(view.queryByTestId("diff")).not.toBeNull();
  });

  it("asks before a very large diff and asks again when the comparison changes", () => {
    const view = render(renderGate({ files: largeFiles, comparisonKey: "a" }));
    expect(view.queryByTestId("diff")).toBeNull();

    fireEvent.click(view.getByTestId("large-diff-show"));
    expect(onShowDiff).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId("diff")).not.toBeNull();

    view.rerender(renderGate({ files: [...largeFiles], comparisonKey: "a" }));
    expect(view.queryByTestId("diff")).not.toBeNull();

    view.rerender(renderGate({ files: largeFiles, comparisonKey: "b" }));
    expect(view.queryByTestId("diff")).toBeNull();
  });
});
