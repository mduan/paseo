/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
import { useCallback } from "react";
import { Search } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/styles/theme";

const ThemedSearch = withUnistyles(Search);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type HistorySearchMenuProps = {
  searches: string[];
  onSelect: (query: string) => void;
};

function RecentSearchItem({
  query,
  onSelect,
}: Pick<HistorySearchMenuProps, "onSelect"> & { query: string }) {
  const select = useCallback(() => onSelect(query), [onSelect, query]);
  return <DropdownMenuItem onSelect={select}>{query}</DropdownMenuItem>;
}

export function HistorySearchMenu({ searches, onSelect }: HistorySearchMenuProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("sessions.recentSearches")}
        testID="sessions-search-history-trigger"
        hitSlop={8}
      >
        <ThemedSearch size={14} uniProps={mutedColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        width={320}
        maxHeight={360}
        scrollable
        sheetTitle={t("sessions.recentSearches")}
        testID="sessions-search-history-menu"
      >
        <DropdownMenuLabel>{t("sessions.recentSearches")}</DropdownMenuLabel>
        {searches.length ? (
          searches.map((query) => (
            <RecentSearchItem key={query} query={query} onSelect={onSelect} />
          ))
        ) : (
          <DropdownMenuItem disabled>{t("sessions.noRecentSearches")}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
