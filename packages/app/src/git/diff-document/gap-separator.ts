import type { TFunction } from "i18next";
import { DiffGapDirection } from "@/git/diff-gaps";
import type { DiffFileSection, DiffLineRow } from "./types";

const CHEVRON_SIZE = 8;

export function gapSeparatorLabel(t: TFunction) {
  return ({ lines, comments }: { lines: number; comments: number }) => {
    const label = t("workspace.git.diff.unmodifiedLines", { count: lines });
    return comments > 0
      ? `${label} · ${t("workspace.git.diff.hiddenComments", { count: comments })}`
      : label;
  };
}

export function gapSeparatorHeight(lineHeight: number): number {
  return Math.round(lineHeight * 1.5);
}

/**
 * A press anywhere on the separator expands. In the gutter, a two-way separator
 * splits into Down (top half) and Up (bottom half); elsewhere the first direction wins.
 */
export function gapDirectionAt(input: {
  row: DiffLineRow;
  file: DiffFileSection;
  localX: number;
  localY: number;
}): DiffGapDirection | null {
  const directions = input.row.separator?.directions;
  if (!directions?.length) return null;
  if (directions.length === 2 && input.localX < input.file.gutterWidth) {
    return input.localY < input.row.height / 2 ? directions[0]! : directions[1]!;
  }
  return directions[0]!;
}

/** Stroke segments [x1, y1, x2, y2] for the gutter chevrons, relative to the row's top-left. */
export function gapChevronSegments(input: {
  row: DiffLineRow;
  file: DiffFileSection;
}): Array<[number, number, number, number]> {
  const directions = input.row.separator?.directions ?? [];
  const centerX = input.file.gutterWidth / 2;
  const half = CHEVRON_SIZE / 2;
  const quarter = CHEVRON_SIZE / 4;
  const chevron = (centerY: number, pointsDown: boolean) => {
    const tipY = centerY + (pointsDown ? quarter : -quarter);
    const baseY = centerY + (pointsDown ? -quarter : quarter);
    return [
      [centerX - half, baseY, centerX, tipY],
      [centerX, tipY, centerX + half, baseY],
    ] as Array<[number, number, number, number]>;
  };
  const height = input.row.height;
  if (directions.length === 2) {
    return [...chevron(height / 4, true), ...chevron((height * 3) / 4, false)];
  }
  if (directions[0] === DiffGapDirection.All) {
    return [
      ...chevron(height / 2 - quarter - 1, false),
      ...chevron(height / 2 + quarter + 1, true),
    ];
  }
  return chevron(height / 2, directions[0] === DiffGapDirection.Down);
}
