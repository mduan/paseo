import type { ParsedDiffFile } from "@getpaseo/protocol/messages";

type DiffHunk = ParsedDiffFile["hunks"][number];
type DiffLine = DiffHunk["lines"][number];
export type ContextLine = Pick<DiffLine, "content" | "tokens">;

export const DIFF_CONTEXT_EXPAND_STEP = 20;

export enum DiffGapDirection {
  /** Reveal lines below the hunk above. */
  Down = "down",
  /** Reveal lines above the hunk below. */
  Up = "up",
  All = "all",
}

/** Unchanged new-side lines [start, end) hidden before hunk `index`, or after the last hunk. */
export interface DiffGap {
  index: number;
  start: number;
  end: number;
  /** Old-side line number minus new-side line number inside the gap. */
  oldOffset: number;
}

export interface ExpandDiffGapInput {
  path: string;
  gapIndex: number;
  direction: DiffGapDirection;
}

function firstLine(start: number, count: number): number {
  // Git reports an empty side's start as the line before the hunk.
  return count > 0 ? start : start + 1;
}

/** Files without a line count come from daemons that cannot expand context. */
export function canExpandDiffFile(file: ParsedDiffFile): boolean {
  return (
    file.lineCount !== undefined &&
    !file.isNew &&
    !file.isDeleted &&
    (file.status ?? "ok") === "ok" &&
    file.hunks.length > 0
  );
}

export function diffGaps(file: ParsedDiffFile): DiffGap[] {
  if (!canExpandDiffFile(file)) return [];
  const gaps: DiffGap[] = [];
  let start = 1;
  let oldOffset = 0;
  for (const [index, hunk] of file.hunks.entries()) {
    const newFirst = firstLine(hunk.newStart, hunk.newCount);
    const oldFirst = firstLine(hunk.oldStart, hunk.oldCount);
    gaps.push({ index, start, end: newFirst, oldOffset: oldFirst - newFirst });
    start = newFirst + hunk.newCount;
    oldOffset = oldFirst + hunk.oldCount - start;
  }
  gaps.push({
    index: file.hunks.length,
    start,
    end: Math.max(start, (file.lineCount ?? 0) + 1),
    oldOffset,
  });
  return gaps;
}

export function gapDirections(gap: DiffGap, hunkCount: number): DiffGapDirection[] {
  if (gap.end - gap.start <= DIFF_CONTEXT_EXPAND_STEP) return [DiffGapDirection.All];
  if (gap.index === 0) return [DiffGapDirection.Up];
  if (gap.index === hunkCount) return [DiffGapDirection.Down];
  return [DiffGapDirection.Down, DiffGapDirection.Up];
}

export function gapRangeToExpand(
  gap: DiffGap,
  direction: DiffGapDirection,
): { start: number; end: number } {
  if (direction === DiffGapDirection.Down && gap.end - gap.start > DIFF_CONTEXT_EXPAND_STEP) {
    return { start: gap.start, end: gap.start + DIFF_CONTEXT_EXPAND_STEP };
  }
  if (direction === DiffGapDirection.Up && gap.end - gap.start > DIFF_CONTEXT_EXPAND_STEP) {
    return { start: gap.end - DIFF_CONTEXT_EXPAND_STEP, end: gap.end };
  }
  return { start: gap.start, end: gap.end };
}

/** Expansions are only valid while the hunks they sit between keep their positions. */
export function diffHunkSignature(file: ParsedDiffFile): string {
  return file.hunks
    .map((hunk) => `${hunk.oldStart},${hunk.oldCount},${hunk.newStart},${hunk.newCount}`)
    .join(";");
}

interface PendingHunk {
  lines: DiffLine[];
  oldStart: number;
  newStart: number;
  oldCount: number;
  newCount: number;
  /** The untouched source hunk, reused when nothing was merged into it. */
  source: DiffHunk | null;
}

/** Merges expanded unchanged lines into the hunks as context lines. */
export function applyDiffContextLines(
  file: ParsedDiffFile,
  lines: ReadonlyMap<number, ContextLine>,
): ParsedDiffFile {
  if (lines.size === 0) return file;
  const hunks: DiffHunk[] = [];
  let pending: PendingHunk | null = null;
  const flush = () => {
    if (!pending) return;
    hunks.push(
      pending.source ?? {
        oldStart: pending.oldStart,
        oldCount: pending.oldCount,
        newStart: pending.newStart,
        newCount: pending.newCount,
        lines: [
          {
            type: "header",
            content: `@@ -${pending.oldStart},${pending.oldCount} +${pending.newStart},${pending.newCount} @@`,
          },
          ...pending.lines,
        ],
      },
    );
    pending = null;
  };

  for (const gap of diffGaps(file)) {
    for (let lineNumber = gap.start; lineNumber < gap.end; lineNumber += 1) {
      const line = lines.get(lineNumber);
      if (!line) {
        flush();
        continue;
      }
      pending ??= {
        lines: [],
        oldStart: lineNumber + gap.oldOffset,
        newStart: lineNumber,
        oldCount: 0,
        newCount: 0,
        source: null,
      };
      pending.source = null;
      pending.lines.push({ type: "context", content: line.content, tokens: line.tokens });
      pending.oldCount += 1;
      pending.newCount += 1;
    }
    const hunk = file.hunks[gap.index];
    if (!hunk) continue;
    if (pending) {
      pending.source = null;
      pending.oldCount += hunk.oldCount;
      pending.newCount += hunk.newCount;
    } else {
      // Merged hunks have context on both sides, so they start at their first real line.
      pending = {
        lines: [],
        oldStart: firstLine(hunk.oldStart, hunk.oldCount),
        newStart: firstLine(hunk.newStart, hunk.newCount),
        oldCount: hunk.oldCount,
        newCount: hunk.newCount,
        source: hunk,
      };
    }
    pending.lines.push(...hunk.lines.filter((line) => line.type !== "header"));
  }
  flush();
  return { ...file, hunks };
}
