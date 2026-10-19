/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
import { useCallback, useMemo } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronsUpDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { SearchOptions } from "@getpaseo/protocol/search/options";
import type { useHistorySearch } from "@/hooks/use-history-search";
import {
  iconButtonChromeStyle,
  mutedIconColorMapping,
  type IconButtonChromeState,
} from "@/components/ui/icon-button-chrome";
import { isNative } from "@/constants/platform";
import { SearchField, type SearchFieldProps } from "@/components/ui/search-field";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

enum SearchOption {
  CaseSensitive = "caseSensitive",
  WholeWord = "wholeWord",
  Regex = "regex",
  IncludeFolded = "includeFolded",
}

const OPTIONS = [
  { option: SearchOption.CaseSensitive, label: "Aa" },
  { option: SearchOption.WholeWord, label: "ab" },
  { option: SearchOption.Regex, label: ".*" },
];

const FoldIcon = withUnistyles(ChevronsUpDown, mutedIconColorMapping);
type ToggleOptions = SearchOptions & { includeFolded?: boolean };
type SearchOptionsProps = {
  value: ToggleOptions;
  supported: boolean;
  onChange: (value: ToggleOptions) => void;
  testIDPrefix?: string;
};

function SearchOptionButton({
  value,
  supported,
  onChange,
  option,
  label: symbol,
  testIDPrefix = "sessions-search",
}: SearchOptionsProps & { option: SearchOption; label?: string }) {
  const { t } = useTranslation();
  const disabled = !supported;
  const selected = Boolean(value[option]) && !disabled;
  const label =
    option === SearchOption.IncludeFolded
      ? t("paneFind.includeCollapsedWork")
      : t(`sessions.searchOptions.${option}`);
  let hint = label;
  if (!supported) hint = t("sessions.searchOptions.updateHost");
  const buttonStyle = useCallback(
    (state: IconButtonChromeState) =>
      iconButtonChromeStyle({
        size: isNative ? "small" : "large",
        compact: isNative,
        state: { ...state, active: selected },
        disabled,
      }),
    [disabled, selected],
  );
  const accessibilityState = useMemo(() => ({ selected, disabled }), [selected, disabled]);
  const toggle = useCallback(
    () => onChange({ ...value, [option]: !value[option] }),
    [onChange, option, value],
  );
  return (
    <Tooltip>
      <TooltipTrigger
        aria-disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={accessibilityState}
        aria-pressed={selected}
        testID={`${testIDPrefix}-${option}`}
        style={buttonStyle}
        onPress={disabled ? undefined : toggle}
      >
        {option === SearchOption.IncludeFolded ? (
          <FoldIcon size={14} />
        ) : (
          <Text style={[styles.symbol, option === SearchOption.WholeWord && styles.wholeWord]}>
            {symbol}
          </Text>
        )}
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.tooltip}>{hint}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function SearchOptionGroup({
  includeFolded = false,
  ...props
}: SearchOptionsProps & { includeFolded?: boolean }) {
  return (
    <View style={styles.options}>
      <View style={styles.separator} />
      {OPTIONS.map(({ option, label }) => (
        <SearchOptionButton key={option} option={option} label={label} {...props} />
      ))}
      {includeFolded ? <SearchOptionButton option={SearchOption.IncludeFolded} {...props} /> : null}
    </View>
  );
}

export function HistorySearchField({
  search,
  supported,
  leading,
  onCommit,
}: {
  search: ReturnType<typeof useHistorySearch>;
  supported: boolean;
} & Pick<SearchFieldProps, "leading" | "onCommit">) {
  const { t } = useTranslation();
  const trailing = useMemo(
    () => (
      <SearchOptionGroup
        value={search.options}
        supported={supported}
        onChange={search.setOptions}
      />
    ),
    [search.options, search.setOptions, supported],
  );
  return (
    <View style={styles.field}>
      <SearchField
        fullWidth
        autoFocus
        invalid={search.invalid}
        trailing={trailing}
        leading={leading}
        onCommit={onCommit}
        value={search.input}
        onChangeText={search.setInput}
        placeholder={t("sessions.searchPlaceholder")}
        clearAccessibilityLabel={t("sessions.actions.clearSearch")}
        testID="sessions-search-input"
        clearTestID="sessions-search-clear"
      />
      {!supported ? (
        <Text style={styles.hint} testID="sessions-search-update-host">
          {t("sessions.searchOptions.updateHost")}
        </Text>
      ) : null}
      {search.invalid ? (
        <Text style={styles.error} accessibilityRole="alert" testID="sessions-search-error">
          {t("sessions.searchOptions.invalidRegex")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: { gap: theme.spacing[2] },
  options: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  separator: {
    width: theme.borderWidth[1],
    height: theme.spacing[4],
    marginRight: theme.spacing[1],
    backgroundColor: theme.colors.border,
  },
  symbol: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  wholeWord: { textDecorationLine: "underline" },
  tooltip: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
}));
