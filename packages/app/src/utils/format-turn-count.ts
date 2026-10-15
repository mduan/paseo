import { i18n } from "@/i18n/i18next";

export function formatTurnCount(count: number | undefined): string | undefined {
  if (count === undefined) return undefined;
  return i18n.t(count === 1 ? "common.turns.one" : "common.turns.other", { count });
}
