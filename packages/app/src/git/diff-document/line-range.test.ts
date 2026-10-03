import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { describe, expect, it } from "vitest";
import { hitTestDiffDocument } from "./hit-testing";
import {
  hitTestLineGutter,
  isLineHighlighted,
  lineDragRange,
  LineGutterPart,
  resolveLineHighlight,
  type LineDragAnchor,
} from "./line-range";
import { buildDiffDocumentModel } from "./model";
import type { DiffDocumentModel, DiffLineRow } from "./types";

describe("diff line ranges", () => {
  it("classifies presses on the line number and add button, but not the code", () => {
    const model = buildModel("unified");
    const row = lineRow(model, "src/a.ts:new:1");
    const gutterWidth = model.files[0]!.gutterWidth;
    const gutterHit = (x: number, documentY = row.top + 9) =>
      hitTestLineGutter({
        model,
        hit: hitTestDiffDocument({ model, x, documentY, horizontalOffset: 0 }),
        x,
        documentY,
      });

    expect(gutterHit(2)).toMatchObject({
      part: LineGutterPart.LineNumber,
      anchor: { rowIndex: row.index, cellIndex: 0, target: { key: "src/a.ts:new:1" } },
    });
    expect(gutterHit(gutterWidth - 4)?.part).toBe(LineGutterPart.AddButton);
    expect(gutterHit(gutterWidth + 4)?.part).toBe(LineGutterPart.AddButton);
    expect(gutterHit(gutterWidth + 30)).toBeUndefined();
    const header = model.rows[0]!;
    expect(gutterHit(2, header.top + 9)).toBeUndefined();
  });

  it("orders a unified drag across hunks and keeps each end's own side", () => {
    const model = buildModel("unified");
    const anchor = anchorAt(model, "src/a.ts:old:1");

    const down = lineDragRange({
      model,
      anchor,
      documentY: lineRow(model, "src/a.ts:new:12").top + 4,
    });
    expect([down.start, down.end.key]).toEqual([
      expect.objectContaining({ side: "old", lineNumber: 1 }),
      "src/a.ts:new:12",
    ]);

    const upward = lineDragRange({
      model,
      anchor: anchorAt(model, "src/a.ts:new:12"),
      documentY: lineRow(model, "src/a.ts:new:1").top,
    });
    expect(upward.start).toMatchObject({ side: "new", lineNumber: 1 });
    expect(upward.end.key).toBe("src/a.ts:new:12");
  });

  it("skips hunk headers toward the anchor and clamps to the anchor's file", () => {
    const model = buildModel("unified");
    const anchor = anchorAt(model, "src/a.ts:new:12");
    const secondHeader = model.rows.find(
      (row) => row.kind === "line" && row.cells[0]?.content === "@@ -10,2 +10,3 @@",
    )!;

    expect(lineDragRange({ model, anchor, documentY: secondHeader.top + 2 }).start).toMatchObject({
      side: "new",
      lineNumber: 10,
    });
    expect(lineDragRange({ model, anchor, documentY: 0 }).start).toMatchObject({
      side: "old",
      lineNumber: 1,
    });
    const pastEnd = lineDragRange({
      model,
      anchor: anchorAt(model, "src/a.ts:old:1"),
      documentY: model.height + 100,
    });
    expect(pastEnd.end.key).toBe("src/a.ts:new:12");
  });

  it("clamps a split drag to the column where it started", () => {
    const model = buildModel("split");
    const anchor = anchorAt(model, "src/a.ts:old:1");
    expect(anchor.cellIndex).toBe(0);

    const range = lineDragRange({
      model,
      anchor,
      documentY: lineRow(model, "src/a.ts:new:12").top + 4,
    });
    expect(range.start).toMatchObject({ side: "old", lineNumber: 1 });
    expect(range.end.key).toBe("src/a.ts:old:11");
  });

  it("tints reviewable lines in the range and pins the add button on the bottom line", () => {
    const model = buildModel("unified");
    const start = anchorAt(model, "src/a.ts:old:1").target;
    const end = anchorAt(model, "src/a.ts:new:12").target;
    const highlight = resolveLineHighlight(model, { start, end });
    const endRow = lineRow(model, end.key);

    expect(highlight).toMatchObject({
      startRowIndex: lineRow(model, start.key).index,
      endRowIndex: endRow.index,
      cellIndex: 0,
      addButton: { left: model.files[0]!.gutterWidth - 12, top: endRow.top - 2 },
      addButtonTargetKey: end.key,
    });
    const highlighted = model.rows
      .filter((row): row is DiffLineRow => row.kind === "line")
      .filter((row) => isLineHighlighted(highlight, row, 0))
      .map((row) => row.cells[0]?.reviewTarget?.key);
    expect(highlighted).toEqual([
      "src/a.ts:old:1",
      "src/a.ts:new:1",
      "src/a.ts:new:2",
      "src/a.ts:new:10",
      "src/a.ts:new:11",
      "src/a.ts:new:12",
    ]);
  });

  it("does not resolve a highlight whose ends sit in different split columns", () => {
    const model = buildModel("split");
    const start = anchorAt(model, "src/a.ts:old:1").target;
    const end = anchorAt(model, "src/a.ts:new:12").target;
    expect(resolveLineHighlight(model, { start, end })).toBeUndefined();
  });
});

function buildModel(layout: "unified" | "split"): DiffDocumentModel {
  return buildDiffDocumentModel({
    files: [twoHunkFile(), otherFile()],
    collapsedFilePaths: new Set(),
    layout,
    wrapLines: true,
    viewportWidth: 400,
    typography: { family: "monospace", size: 12, lineHeight: 18 },
    measureText: { measure: (text: string) => Array.from(text).length * 10 },
    palette: {
      surface: "#000",
      headerSurface: "#111",
      border: "#222",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      addition: "green",
      deletion: "red",
      additionBackground: "#010",
      deletionBackground: "#100",
      emptyBackground: "#111",
      selection: "blue",
      headerActiveSurface: "#222",
      headerBorder: "#333",
      statusSuccess: "green",
      statusDanger: "red",
      statusWarning: "orange",
      syntax: {},
    },
    labels: { binary: "Binary", tooLarge: "Too large" },
  });
}

function lineRow(model: DiffDocumentModel, key: string): DiffLineRow {
  const row = model.rows.find(
    (candidate) =>
      candidate.kind === "line" && candidate.cells.some((cell) => cell?.reviewTarget?.key === key),
  );
  if (!row || row.kind !== "line") throw new Error(`Expected a row for ${key}`);
  return row;
}

function anchorAt(model: DiffDocumentModel, key: string): LineDragAnchor {
  const row = lineRow(model, key);
  const cellIndex = row.cells.findIndex((cell) => cell?.reviewTarget?.key === key);
  const target = row.cells[cellIndex]!.reviewTarget!;
  return { fileIndex: row.fileIndex, rowIndex: row.index, cellIndex, target };
}

function twoHunkFile(): ParsedDiffFile {
  return {
    path: "src/a.ts",
    isNew: false,
    isDeleted: false,
    additions: 2,
    deletions: 1,
    hunks: [
      {
        oldStart: 1,
        oldCount: 2,
        newStart: 1,
        newCount: 2,
        lines: [
          { type: "header", content: "@@ -1,2 +1,2 @@" },
          { type: "remove", content: "old" },
          { type: "add", content: "new" },
          { type: "context", content: "same" },
        ],
      },
      {
        oldStart: 10,
        oldCount: 2,
        newStart: 10,
        newCount: 3,
        lines: [
          { type: "header", content: "@@ -10,2 +10,3 @@" },
          { type: "context", content: "ten" },
          { type: "context", content: "eleven" },
          { type: "add", content: "added" },
        ],
      },
    ],
  };
}

function otherFile(): ParsedDiffFile {
  return {
    path: "src/b.ts",
    isNew: true,
    isDeleted: false,
    additions: 1,
    deletions: 0,
    hunks: [
      {
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: 1,
        lines: [
          { type: "header", content: "@@ -0,0 +1 @@" },
          { type: "add", content: "other" },
        ],
      },
    ],
  };
}
