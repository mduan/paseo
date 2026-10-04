import type { ParsedDiffFile } from "@/git/use-diff-query";
import {
  buildNumberedDiffHunks,
  type NumberedDiffLine,
  type ReviewableDiffTargetKeyInput,
} from "@/utils/diff-layout";
import type { ReviewLineRange } from "./range";
import type { ReviewDraftCommentContext, ReviewDraftSide } from "./state";

const CONTEXT_RADIUS = 3;
const MAX_CONTEXT_LINES = 80;

type ReviewContextLine = ReviewDraftCommentContext["targetLine"];

/** Context of only the commented line, for when nothing around it is known. */
export function singleLineReviewContext(input: {
  side: ReviewDraftSide;
  lineNumber: number;
  content: string;
}): ReviewDraftCommentContext {
  const targetLine: ReviewContextLine = {
    oldLineNumber: input.side === "old" ? input.lineNumber : null,
    newLineNumber: input.side === "new" ? input.lineNumber : null,
    type: "context",
    content: input.content,
  };
  return { hunkHeader: "", targetLine, lines: [targetLine] };
}

function toContextLine(line: NumberedDiffLine): ReviewContextLine | null {
  if (line.line.type === "header") {
    return null;
  }
  return {
    oldLineNumber: line.oldLineNumber,
    newLineNumber: line.newLineNumber,
    type: line.line.type,
    content: line.line.content,
  };
}

function findLineIndex(
  lines: readonly NumberedDiffLine[],
  line: Pick<ReviewableDiffTargetKeyInput, "side" | "lineNumber">,
): number {
  return lines.findIndex((candidate) => {
    const cell = line.side === "old" ? candidate.oldCell : candidate.newCell;
    return cell?.lineNumber === line.lineNumber;
  });
}

/** The range plus surrounding lines from the diff, kept inside the hunks that hold the range ends. */
export function buildDiffReviewContext(input: {
  range: ReviewLineRange;
  diffFiles: readonly ParsedDiffFile[];
}): ReviewDraftCommentContext | undefined {
  const { start, end } = input.range;
  const file = input.diffFiles.find((candidate) => candidate.path === end.filePath);
  if (!file) {
    return singleLineReviewContext(end);
  }

  // Ranges may span hunks of one file, so search the file's lines in display order.
  const fileLines = buildNumberedDiffHunks(file).flatMap((hunk) => hunk.lines);
  const endIndex = findLineIndex(fileLines, end);
  if (endIndex < 0) {
    return singleLineReviewContext(end);
  }
  const startIndex = findLineIndex(fileLines, start);
  const startLine = fileLines[startIndex];
  const endLine = fileLines[endIndex];
  if (!startLine || !endLine || startIndex > endIndex) {
    return undefined;
  }
  const targetLine = toContextLine(endLine);
  if (!targetLine) {
    return undefined;
  }

  const startHunkFirstIndex = fileLines.findIndex((line) => line.hunkIndex === startLine.hunkIndex);
  const endHunkLastIndex = fileLines.findLastIndex((line) => line.hunkIndex === endLine.hunkIndex);
  const contextStart = Math.max(startHunkFirstIndex, startIndex - CONTEXT_RADIUS);
  const contextEnd = Math.min(endHunkLastIndex, endIndex + CONTEXT_RADIUS) + 1;

  // The server tells the agent to read the file when the range end is cut off.
  const lines = fileLines
    .slice(contextStart, contextEnd)
    .map(toContextLine)
    .filter((line): line is ReviewContextLine => line !== null)
    .slice(0, MAX_CONTEXT_LINES);

  return { hunkHeader: startLine.hunkHeader, targetLine, lines };
}

/** The range plus surrounding lines of a whole file, numbered as new-side context lines. */
export function buildFileReviewContext(input: {
  range: ReviewLineRange;
  lineCount: number;
  lineText: (lineNumber: number) => string;
}): ReviewDraftCommentContext | undefined {
  const endLineNumber = input.range.end.lineNumber;
  const startLineNumber = Math.min(input.range.start.lineNumber, endLineNumber);
  if (endLineNumber > input.lineCount) {
    return undefined;
  }
  const toLine = (lineNumber: number): ReviewContextLine => ({
    oldLineNumber: null,
    newLineNumber: lineNumber,
    type: "context",
    content: input.lineText(lineNumber),
  });
  const first = Math.max(1, startLineNumber - CONTEXT_RADIUS);
  const last = Math.min(
    input.lineCount,
    endLineNumber + CONTEXT_RADIUS,
    first + MAX_CONTEXT_LINES - 1,
  );
  const lines: ReviewContextLine[] = [];
  for (let lineNumber = first; lineNumber <= last; lineNumber += 1) {
    lines.push(toLine(lineNumber));
  }
  return { hunkHeader: "", targetLine: toLine(endLineNumber), lines };
}
