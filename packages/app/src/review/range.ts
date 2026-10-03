import {
  buildReviewableDiffTargetKey,
  type ReviewableDiffTarget,
  type ReviewableDiffTargetKeyInput,
} from "@/utils/diff-layout";
import type { ReviewDraftComment } from "./store";

/** Diff lines in display order. A comment on the range anchors its thread under `end`. */
export interface ReviewLineRange {
  start: ReviewableDiffTargetKeyInput;
  end: ReviewableDiffTarget;
}

export function singleLineRange(target: ReviewableDiffTarget): ReviewLineRange {
  return { start: target, end: target };
}

export function isSingleLineRange(range: ReviewLineRange): boolean {
  return buildReviewableDiffTargetKey(range.start) === range.end.key;
}

export function isSameReviewLineRange(
  left: ReviewLineRange | undefined,
  right: ReviewLineRange | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.end.key === right.end.key &&
    buildReviewableDiffTargetKey(left.start) === buildReviewableDiffTargetKey(right.start),
  );
}

/** Clicking the single highlighted line clears it; clicking any other line highlights only that line. */
export function toggleLineHighlight(
  current: ReviewLineRange | undefined,
  target: ReviewableDiffTarget,
): ReviewLineRange | undefined {
  if (current && isSingleLineRange(current) && current.end.key === target.key) return undefined;
  return singleLineRange(target);
}

export function commentLineRange(
  comment: ReviewDraftComment,
  target: ReviewableDiffTarget,
): ReviewLineRange {
  if (!comment.startSide || !comment.startLineNumber) return singleLineRange(target);
  return {
    start: {
      filePath: comment.filePath,
      side: comment.startSide,
      lineNumber: comment.startLineNumber,
    },
    end: target,
  };
}

/** `L` marks the old side and `R` the new side, e.g. `R42`. */
export function reviewLineLabel(line: Pick<ReviewableDiffTargetKeyInput, "side" | "lineNumber">) {
  return `${line.side === "old" ? "L" : "R"}${line.lineNumber}`;
}
