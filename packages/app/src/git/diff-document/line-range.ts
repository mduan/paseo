import { singleLineRange, type ReviewLineRange } from "@/review/range";
import { buildReviewableDiffTargetKey, type ReviewableDiffTarget } from "@/utils/diff-layout";
import { rowAtOffset } from "./hit-testing";
import type { DiffDocumentModel, DiffHit, DiffLineRow, DiffRow } from "./types";

const ADD_BUTTON_SIZE = 22;
/** How far the add button reaches left of the gutter border. */
const ADD_BUTTON_GUTTER_OVERLAP = 12;

export enum LineGutterPart {
  LineNumber = "lineNumber",
  AddButton = "addButton",
}

export interface LineDragAnchor {
  fileIndex: number;
  rowIndex: number;
  cellIndex: number;
  target: ReviewableDiffTarget;
}

export interface LineGutterHit {
  part: LineGutterPart;
  anchor: LineDragAnchor;
}

export interface DocumentPoint {
  left: number;
  top: number;
}

export interface ResolvedLineHighlight {
  startRowIndex: number;
  endRowIndex: number;
  /** The tinted column: the whole row in unified layout, one side in split layout. */
  cellIndex: number;
  /** Where the add button stays pinned, on the bottom highlighted line. */
  addButton: DocumentPoint;
  /** Review target key of the line carrying the pinned add button. */
  addButtonTargetKey: string;
}

/** Document coordinates of a line's add button. */
export function addButtonPosition(input: {
  model: DiffDocumentModel;
  row: DiffLineRow;
  cellIndex: number;
}): DocumentPoint {
  const file = input.model.files[input.row.fileIndex];
  const columnWidth = input.model.viewportWidth / input.row.cells.length;
  return {
    left: input.cellIndex * columnWidth + file.gutterWidth - ADD_BUTTON_GUTTER_OVERLAP,
    top: input.row.top + (input.model.lineHeight - ADD_BUTTON_SIZE) / 2,
  };
}

/** A press on a reviewable line's number or add button starts a line-range gesture. */
export function hitTestLineGutter(input: {
  model: DiffDocumentModel;
  hit: DiffHit | null;
  x: number;
  documentY: number;
}): LineGutterHit | undefined {
  if (input.hit?.kind !== "cell" || !input.hit.target) return undefined;
  const { position, target } = input.hit;
  const row = input.model.rows[position.rowIndex];
  if (row?.kind !== "line") return undefined;
  const anchor = {
    fileIndex: position.fileIndex,
    rowIndex: position.rowIndex,
    cellIndex: position.cellIndex,
    target,
  };
  const button = addButtonPosition({ model: input.model, row, cellIndex: position.cellIndex });
  const isOnButtonX = input.x >= button.left && input.x < button.left + ADD_BUTTON_SIZE;
  const isOnButtonY =
    input.documentY >= button.top && input.documentY < button.top + ADD_BUTTON_SIZE;
  if (isOnButtonX && isOnButtonY) return { part: LineGutterPart.AddButton, anchor };
  const gutterBorder = button.left + ADD_BUTTON_GUTTER_OVERLAP;
  return input.x < gutterBorder ? { part: LineGutterPart.LineNumber, anchor } : undefined;
}

/**
 * The range from the drag anchor to the reviewable line under `documentY`, in display order. The
 * drag stays in the anchor's file and column; lines without a review target are skipped.
 */
export function lineDragRange(input: {
  model: DiffDocumentModel;
  anchor: LineDragAnchor;
  documentY: number;
}): ReviewLineRange {
  const { model, anchor } = input;
  const file = model.files[anchor.fileIndex];
  const firstRow = model.rows[file.rowStart];
  const lastRow = model.rows[file.rowEnd - 1];
  const clampedY = Math.min(
    Math.max(input.documentY, firstRow.top),
    lastRow.top + lastRow.height - 1,
  );
  const row = rowAtOffset(model.rows, file.rowStart, file.rowEnd, clampedY);
  let rowIndex = row?.index ?? anchor.rowIndex;
  const step = rowIndex > anchor.rowIndex ? -1 : 1;
  for (; rowIndex !== anchor.rowIndex; rowIndex += step) {
    const target = reviewTargetAt(model.rows[rowIndex], anchor.cellIndex);
    if (!target) continue;
    return rowIndex < anchor.rowIndex
      ? { start: target, end: anchor.target }
      : { start: anchor.target, end: target };
  }
  return singleLineRange(anchor.target);
}

export function resolveLineHighlight(
  model: DiffDocumentModel,
  range: ReviewLineRange | undefined,
): ResolvedLineHighlight | undefined {
  if (!range) return undefined;
  const file = model.files.find((entry) => entry.path === range.end.filePath);
  if (!file) return undefined;
  const startKey = buildReviewableDiffTargetKey(range.start);
  let start: { rowIndex: number; cellIndex: number } | undefined;
  let end: { row: DiffLineRow; cellIndex: number } | undefined;
  for (let rowIndex = file.rowStart; rowIndex < file.rowEnd; rowIndex += 1) {
    const row = model.rows[rowIndex];
    if (row.kind !== "line") continue;
    row.cells.forEach((cell, cellIndex) => {
      const key = cell?.reviewTarget?.key;
      if (key === startKey) start = { rowIndex, cellIndex };
      if (key === range.end.key) end = { row, cellIndex };
    });
  }
  if (!start || !end || start.cellIndex !== end.cellIndex) return undefined;
  return {
    startRowIndex: Math.min(start.rowIndex, end.row.index),
    endRowIndex: Math.max(start.rowIndex, end.row.index),
    cellIndex: end.cellIndex,
    addButton: addButtonPosition({ model, row: end.row, cellIndex: end.cellIndex }),
    addButtonTargetKey: range.end.key,
  };
}

export function isLineHighlighted(
  highlight: ResolvedLineHighlight | undefined,
  row: DiffLineRow,
  cellIndex: number,
): boolean {
  return Boolean(
    highlight &&
    cellIndex === highlight.cellIndex &&
    row.index >= highlight.startRowIndex &&
    row.index <= highlight.endRowIndex &&
    row.cells[cellIndex]?.reviewTarget,
  );
}

function reviewTargetAt(row: DiffRow, cellIndex: number): ReviewableDiffTarget | null {
  if (row.kind !== "line") return null;
  return row.cells[cellIndex]?.reviewTarget ?? null;
}
