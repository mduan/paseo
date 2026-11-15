import { formatAmount, formatPct } from "./format";
import { balanceUsed, displayPercent, summaryWindows } from "./model";
import { effectiveUsagePins, type UsagePreferences } from "./preferences";
import { windowTone } from "./tone";
import type { UsageBalance, UsageReportEntry, UsageTone, UsageWindow } from "./types";

/** One summary window of one account, as the sidebar Usage item shows it. */
export interface PinnedUsageWindow {
  key: string;
  /** Accessible description, including the source, account, window and percent meaning. */
  label: string;
  tooltip: string;
  resetsAt?: string | null;
  /** The window's short name ("5h"), empty for none, or its label when the source sends none. */
  shortLabel: string;
  /** The share shown, under the user's used/remaining preference. */
  percent: number;
  percentText: string;
  tone: UsageTone;
}

/** One account's summary windows, under its source's icon. */
export interface PinnedUsageSource {
  key: string;
  icon: string | null;
  windows: PinnedUsageWindow[];
}

/** How much of each window the one-line summary has room for. */
export type PinnedUsageLayout = "meters" | "labels" | "percents";

// A meter narrower than this is a sliver that reads as noise rather than a share.
export const MIN_METER_WIDTH = 16;
/** The space between a meter and its text. */
export const METER_GAP = 4;

/**
 * The richest layout that fits on one line: every window's meter, else its short label, else its
 * percent alone. Meters are all or none; a line never mixes them. Until the widths are known it
 * shows labels, which never flashes meters that turn out not to fit.
 */
export function choosePinnedUsageLayout(input: {
  available: number | null;
  labelsWidth: number | null;
  percentsWidth: number | null;
  windowCount: number;
}): PinnedUsageLayout {
  const { available, labelsWidth, percentsWidth, windowCount } = input;
  if (available === null || labelsWidth === null || percentsWidth === null) return "labels";
  if (labelsWidth + windowCount * (MIN_METER_WIDTH + METER_GAP) <= available) return "meters";
  if (labelsWidth <= available) return "labels";
  return percentsWidth < labelsWidth ? "percents" : "labels";
}

function describe(entry: UsageReportEntry, windowLabel: string): string {
  const account = entry.account.label ? ` (${entry.account.label})` : "";
  return `${entry.sourceLabel}${account} ${windowLabel}`;
}

export function usageTooltip({
  sourceId,
  sourceLabel,
  window,
  balance,
  locale,
}: {
  sourceId: string;
  sourceLabel: string;
  window: UsageWindow;
  balance?: UsageBalance;
  locale: string;
}): string {
  const parts = sourceId === "antigravity" ? [] : [sourceLabel];
  const label = window.label === "Session" && window.shortLabel === "5h" ? "5-hour" : window.label;
  const scope = label.split(" · ");
  if (scope.length > 1 && scope[0] === "Weekly") parts.push(...scope.slice(1), "Weekly");
  else parts.push(label);
  if (balance) {
    const used = balanceUsed(balance);
    const format = (amount: number) => formatAmount(amount, balance.unit, locale);
    if (used != null && balance.limit != null && balance.limit > 0)
      parts.push(`${format(used)} of ${format(balance.limit)} used`);
    else if (balance.remaining != null) parts.push(`${format(balance.remaining)} remaining`);
  }
  return parts.join(" · ");
}

/** Reports with every account of a source together, sources in the order they first appear. */
function groupBySource(reports: readonly UsageReportEntry[]): UsageReportEntry[] {
  const sourceIds = [...new Set(reports.map((entry) => entry.sourceId))];
  return sourceIds.flatMap((sourceId) => reports.filter((entry) => entry.sourceId === sourceId));
}

/**
 * The sidebar Usage item's summary: one group per account, grouped by source, each with its
 * windows in its report's order. Accounts with nothing to show are left out.
 */
export function resolvePinnedUsage(
  reports: readonly UsageReportEntry[],
  preferences: UsagePreferences,
  { locale = "en" }: { locale?: string } = {},
): PinnedUsageSource[] {
  const pins = effectiveUsagePins(preferences, reports);
  const meaning = preferences.displayAs === "remaining" ? "left" : "used";
  return groupBySource(reports).flatMap((entry) => {
    const report = entry.report;
    if (report.status !== "available") return [];
    const windows = summaryWindows(report)
      .filter(
        (window) =>
          displayPercent(window, preferences.displayAs) !== null &&
          pins.some((pin) => pin.sourceId === entry.sourceId && pin.windowId === window.id),
      )
      .map((window) => {
        const percent = displayPercent(window, preferences.displayAs) ?? 0;
        const percentText = formatPct(percent);
        return {
          key: `${entry.id}/${window.id}`,
          label: `${describe(entry, window.label)} ${percentText} ${meaning}`,
          tooltip: usageTooltip({
            sourceId: entry.sourceId,
            sourceLabel: entry.sourceLabel,
            window,
            balance: report.balances?.find((balance) => window.id === `balance:${balance.id}`),
            locale,
          }),
          resetsAt: window.resetsAt,
          shortLabel: window.shortLabel ?? window.label,
          percent,
          percentText,
          tone: windowTone(window),
        };
      });
    if (windows.length === 0) return [];
    return [{ key: entry.id, icon: entry.icon ?? null, windows }];
  });
}
