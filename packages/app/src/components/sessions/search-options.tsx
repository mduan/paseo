/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
import { useCallback, useMemo } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { SearchOptions } from "@getpaseo/protocol/search/options";
import type { useHistorySearch } from "@/hooks/use-history-search";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

enum SearchOption {
  CaseSensitive = "caseSensitive",
  WholeWord = "wholeWord",
  Regex = "regex",
}

const OPTIONS = [
  { option: SearchOption.CaseSensitive, label: "Aa" },
  { option: SearchOption.WholeWord, label: "ab" },
  { option: SearchOption.Regex, label: ".*" },
];

type SearchOptionsProps = {
  value: SearchOptions;
  supported: boolean;
  onChange: (value: SearchOptions) => void;
};

function SearchOptionButton({
  value,
  supported,
  onChange,
  option,
  label: symbol,
}: SearchOptionsProps & (typeof OPTIONS)[number]) {
  const { t } = useTranslation();
  const disabled = !supported || Boolean(option === SearchOption.WholeWord && value.regex);
  const selected = Boolean(value[option]) && !disabled;
  const label = t(`sessions.searchOptions.${option}`);
  let hint = label;
  if (!supported) hint = t("sessions.searchOptions.updateHost");
  else if (option === SearchOption.WholeWord && value.regex)
    hint = t("sessions.searchOptions.wholeWordRegex");
  const accessibilityState = useMemo(() => ({ selected, disabled }), [selected, disabled]);
  const toggle = useCallback(
    () => onChange({ ...value, [option]: !value[option] }),
    [onChange, option, value],
  );
  return (
    <Tooltip enabledOnMobile>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          accessibilityLabel={label}
          accessibilityHint={hint}
          accessibilityState={accessibilityState}
          aria-pressed={selected}
          testID={`sessions-search-${option}`}
          style={selected && styles.selected}
          textStyle={option === SearchOption.WholeWord && styles.wholeWord}
          onPress={toggle}
        >
          {symbol}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.tooltip}>{hint}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function HistorySearchOptions(props: SearchOptionsProps) {
  return (
    <View style={styles.options}>
      {OPTIONS.map(({ option, label }) => (
        <SearchOptionButton key={option} option={option} label={label} {...props} />
      ))}
    </View>
  );
}

export function HistorySearchField({
  search,
  supported,
}: {
  search: ReturnType<typeof useHistorySearch>;
  supported: boolean;
}) {
  const { t } = useTranslation();
  const trailing = useMemo(
    () => (
      <HistorySearchOptions
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
  options: { flexDirection: "row", alignItems: "center" },
  selected: { backgroundColor: theme.colors.interactionHighlight },
  wholeWord: { textDecorationLine: "underline" },
  tooltip: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
}));
