import { describe, expect, it } from "vitest";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import {
  DiffGapDirection,
  applyDiffContextLines,
  diffGaps,
  gapDirections,
  gapRangeToExpand,
} from "./diff-gaps";
import { buildNumberedDiffHunks } from "@/utils/diff-layout";

function file(overrides: Partial<ParsedDiffFile> = {}): ParsedDiffFile {
  return {
    path: "src/a.ts",
    isNew: false,
    isDeleted: false,
    additions: 1,
    deletions: 1,
    lineCount: 100,
    hunks: [
      {
        oldStart: 10,
        oldCount: 2,
        newStart: 10,
        newCount: 2,
        lines: [
          { type: "header", content: "@@ -10,2 +10,2 @@" },
          { type: "remove", content: "old" },
          { type: "add", content: "new" },
          { type: "context", content: "c11" },
        ],
      },
      {
        // Pure addition after old line 60: new lines 61-62.
        oldStart: 60,
        oldCount: 0,
        newStart: 61,
        newCount: 2,
        lines: [
          { type: "header", content: "@@ -60,0 +61,2 @@" },
          { type: "add", content: "a61" },
          { type: "add", content: "a62" },
        ],
      },
    ],
    ...overrides,
  };
}

function contextLines(start: number, end: number) {
  return new Map(
    Array.from({ length: end - start }, (_, index) => [
      start + index,
      { content: `n${start + index}` },
    ]),
  );
}

describe("diffGaps", () => {
  it("finds the gaps before, between, and after hunks", () => {
    expect(diffGaps(file())).toEqual([
      { index: 0, start: 1, end: 10, oldOffset: 0 },
      { index: 1, start: 12, end: 61, oldOffset: 0 },
      { index: 2, start: 63, end: 101, oldOffset: -2 },
    ]);
  });

  it("has no gaps without a line count or for new files", () => {
    expect(diffGaps(file({ lineCount: undefined }))).toEqual([]);
    expect(diffGaps(file({ isNew: true }))).toEqual([]);
  });
});

describe("gap expansion", () => {
  it("offers one direction at the file edges and both between hunks", () => {
    const [before, between, after] = diffGaps(file());
    expect(gapDirections(before!, 2)).toEqual([DiffGapDirection.All]);
    expect(gapDirections(between!, 2)).toEqual([DiffGapDirection.Down, DiffGapDirection.Up]);
    expect(gapDirections(after!, 2)).toEqual([DiffGapDirection.Down]);
    expect(gapRangeToExpand(between!, DiffGapDirection.Down)).toEqual({ start: 12, end: 32 });
    expect(gapRangeToExpand(between!, DiffGapDirection.Up)).toEqual({ start: 41, end: 61 });
  });

  it("merges expanded lines as context with matching line numbers", () => {
    const expanded = applyDiffContextLines(file(), contextLines(12, 15));
    expect(expanded.hunks).toHaveLength(2);
    expect(expanded.hunks[0]).toMatchObject({ oldStart: 10, oldCount: 5, newStart: 10 });
    const lines = buildNumberedDiffHunks(expanded)[0]!.lines.at(-1)!;
    expect(lines).toMatchObject({ oldLineNumber: 14, newLineNumber: 14 });
    expect(diffGaps(expanded)[1]).toMatchObject({ start: 15, end: 61 });
  });

  it("joins hunks when a gap is fully expanded", () => {
    const expanded = applyDiffContextLines(file(), contextLines(12, 61));
    expect(expanded.hunks).toHaveLength(1);
    expect(expanded.hunks[0]).toMatchObject({
      oldStart: 10,
      oldCount: 51,
      newStart: 10,
      newCount: 53,
    });
  });

  it("numbers context after a pure addition from the next old line", () => {
    const expanded = applyDiffContextLines(file(), contextLines(63, 65));
    const hunk = buildNumberedDiffHunks(expanded)[1]!;
    expect(hunk.lines.at(-1)).toMatchObject({ oldLineNumber: 62, newLineNumber: 64 });
  });
});
