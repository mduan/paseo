import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToolbarLabelSelectTrigger } from "@/components/ui/toolbar-label-trigger";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useToast } from "@/contexts/toast-context";
import { useFetchQuery } from "@/data/query";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";
import { buildBaseRefComboOptions } from "@/utils/branch-suggestions";

interface BaseRefSwitcherProps {
  baseRefLabel: string;
  serverId: string;
  workspaceId: string;
  cwd: string;
}

const ThemedArrowRight = withUnistyles(ArrowRight);

export function BaseRefSwitcher({
  baseRefLabel,
  serverId,
  workspaceId,
  cwd,
}: BaseRefSwitcherProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const canSetBaseRef = useHostFeature(serverId, "checkoutSetBaseRef");
  const toast = useToast();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const branchesQuery = useFetchQuery({
    dataShape: "list",
    queryKey: ["baseRefSuggestions", serverId, workspaceId],
    queryFn: async () => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await client.getBranchSuggestions({ cwd, limit: 200 });
      if (payload.error) {
        throw new Error(payload.error);
      }
      return payload.branchDetails ?? [];
    },
    enabled: isOpen && Boolean(client) && isConnected,
    retry: false,
    staleTimeMs: 15_000,
  });

  const options = useMemo(
    () => buildBaseRefComboOptions(branchesQuery.data ?? []),
    [branchesQuery.data],
  );
  const value = options.find((option) => option.label === baseRefLabel)?.id ?? "";

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleSelect = useCallback(
    (baseRef: string) => {
      if (!client || baseRef === value) return;
      void (async () => {
        try {
          const payload = await client.checkoutSetBaseRef(cwd, baseRef);
          if (payload.error) {
            toast.error(payload.error.message);
            return;
          }
          await invalidateCheckoutGitQueriesForClient(queryClient, { serverId, cwd });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("baseRefSwitcher.failedToSet"));
        }
      })();
    },
    [client, cwd, queryClient, serverId, t, toast, value],
  );

  return (
    <View style={styles.row}>
      <ThemedArrowRight size={12} uniProps={extraMutedIconColorMapping} />
      <View ref={anchorRef} collapsable={false} style={styles.anchor}>
        <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>
            <ToolbarLabelSelectTrigger
              testID="changes-base-ref-switcher"
              label={baseRefLabel}
              open={isOpen}
              onPress={handleOpen}
              disabled={!canSetBaseRef}
              accessibilityRole="button"
              accessibilityLabel={t("baseRefSwitcher.currentBase", { baseRef: baseRefLabel })}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <Text style={styles.tooltipText}>{t("baseRefSwitcher.triggerTooltip")}</Text>
          </TooltipContent>
        </Tooltip>
        <Combobox
          options={options}
          value={value}
          onSelect={handleSelect}
          searchable
          placeholder={t("baseRefSwitcher.placeholder")}
          searchPlaceholder={t("branchSwitcher.searchPlaceholder")}
          emptyText={t("branchSwitcher.empty")}
          title={t("baseRefSwitcher.title")}
          open={isOpen}
          onOpenChange={setIsOpen}
          anchorRef={anchorRef}
          desktopPlacement="bottom-start"
          desktopPreventInitialFlash
          desktopMinWidth={280}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  anchor: {
    flexShrink: 1,
    minWidth: 0,
  },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.sm,
  },
}));
