import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { formatAmount, formatResetLabel } from "./format";
import { balanceUsed } from "./model";
import type { UsageBalance } from "./types";

export function formatBalanceAmount(balance: UsageBalance, locale: string): string {
  const { used, remaining, limit, unit } = balance;
  const format = (value: number) => formatAmount(value, unit, locale);
  if (limit != null && limit > 0) {
    const usedAmount = balanceUsed(balance);
    return `${usedAmount != null ? format(usedAmount) : "—"} / ${format(limit)}`;
  }
  if (remaining != null) return `${format(remaining)} left`;
  if (used != null) return format(used);
  return "—";
}

/** A balance with no share to show; one spent against a limit renders as a window row. */
export function UsageBalanceBar({ balance }: { balance: UsageBalance }) {
  const { i18n } = useTranslation();
  const resetLabel = formatResetLabel(balance.resetsAt);
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label} numberOfLines={1}>
        {balance.label}
      </Text>
      <Text style={styles.value}>
        {formatBalanceAmount(balance, i18n.language)}
        {resetLabel ? <Text style={styles.reset}>{` · ${resetLabel}`}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  label: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  value: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  reset: {
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
  },
}));
