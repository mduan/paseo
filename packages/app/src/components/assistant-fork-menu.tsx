import { createContext, memo, useCallback, useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Split } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/use-settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { AgentForkMode } from "@getpaseo/protocol/agent-labels";

export type AssistantForkTarget = "tab" | "workspace";

export interface AssistantForkRequest {
  target: AssistantForkTarget;
  mode: AgentForkMode;
}

export interface AssistantForkMenuContextValue {
  provider?: string;
  /** The provider can fork its session with full history. */
  supportsFullHistory: boolean;
}

/** Provided by the agent stream so every fork menu in it knows its agent's provider. */
export const AssistantForkMenuContext = createContext<AssistantForkMenuContextValue>({
  supportsFullHistory: false,
});

interface AssistantForkMenuProps {
  onFork: (request: AssistantForkRequest) => Promise<void> | void;
  /** The turn is still running, so the provider hasn't saved it for a full-history fork. */
  inFlight?: boolean;
  testID?: string;
}

const ThemedSplit = withUnistyles(Split);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const AssistantForkMenu = memo(function AssistantForkMenu({
  onFork,
  inFlight = false,
  testID = "assistant-fork-menu",
}: AssistantForkMenuProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<AssistantForkTarget | null>(null);
  const isLocked = pendingTarget !== null;
  const { settings, updateSettings } = useSettings();
  const { provider, supportsFullHistory } = useContext(AssistantForkMenuContext);
  const isFullHistoryUnsupported = !supportsFullHistory;
  const mode = isFullHistoryUnsupported
    ? AgentForkMode.Summary
    : ((provider ? settings.forkModeByProvider[provider] : undefined) ?? AgentForkMode.Full);
  const isFullHistoryPending = mode === AgentForkMode.Full && inFlight;

  const handleModeChange = useCallback(
    (next: AgentForkMode) => {
      if (!provider) return;
      void updateSettings({
        forkModeByProvider: { ...settings.forkModeByProvider, [provider]: next },
      });
    },
    [provider, settings.forkModeByProvider, updateSettings],
  );

  const modeOptions = useMemo(
    () => [
      {
        value: AgentForkMode.Full,
        label: t("message.actions.forkModeFull"),
        disabled: isFullHistoryUnsupported,
        testID: `${testID}-mode-full`,
      },
      {
        value: AgentForkMode.Summary,
        label: t("message.actions.forkModeSummary"),
        testID: `${testID}-mode-summary`,
      },
    ],
    [isFullHistoryUnsupported, t, testID],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && pendingTarget !== null) return;
      setIsOpen(next);
    },
    [pendingTarget],
  );

  const handleSelect = useCallback(
    (target: AssistantForkTarget) => async () => {
      if (isLocked) return;
      setPendingTarget(target);
      try {
        await onFork({ target, mode });
      } finally {
        setPendingTarget(null);
        setIsOpen(false);
      }
    },
    [isLocked, mode, onFork],
  );

  const pendingDescription = isFullHistoryPending
    ? t("message.actions.forkFullHistoryPending")
    : undefined;

  const triggerStyle = useCallback(
    () => [styles.trigger, isLocked ? styles.triggerDisabled : null],
    [isLocked],
  );

  const tooltipContent = useMemo(
    () => (
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("message.actions.forkMenu")}</Text>
      </TooltipContent>
    ),
    [t],
  );

  const forkIcon = useMemo(
    () => <ThemedSplit size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />,
    [],
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <View style={styles.triggerSlot} collapsable={false}>
            <DropdownMenuTrigger
              accessibilityLabel={t("message.actions.forkMenu")}
              accessibilityRole="button"
              disabled={isLocked}
              style={triggerStyle}
              testID={`${testID}-trigger`}
            >
              {({ hovered, open }) => (
                <ThemedSplit
                  size={ICON_SIZE.sm}
                  uniProps={hovered || open ? foregroundColorMapping : foregroundMutedColorMapping}
                />
              )}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        {tooltipContent}
      </Tooltip>
      <DropdownMenuContent align="start" minWidth={240} side="bottom" testID={`${testID}-content`}>
        <View style={styles.modeRow}>
          <SegmentedControl
            options={modeOptions}
            value={mode}
            onValueChange={handleModeChange}
            size="sm"
            testID={`${testID}-mode`}
          />
        </View>
        <DropdownMenuItem
          closeOnSelect={false}
          description={pendingDescription}
          disabled={isFullHistoryPending || (isLocked && pendingTarget !== "tab")}
          leading={forkIcon}
          onSelect={handleSelect("tab")}
          status={pendingTarget === "tab" ? "pending" : undefined}
          testID={`${testID}-new-tab`}
        >
          {t("message.actions.forkInNewTab")}
        </DropdownMenuItem>
        <DropdownMenuItem
          closeOnSelect={false}
          description={pendingDescription}
          disabled={isFullHistoryPending || (isLocked && pendingTarget !== "workspace")}
          leading={forkIcon}
          onSelect={handleSelect("workspace")}
          status={pendingTarget === "workspace" ? "pending" : undefined}
          testID={`${testID}-new-workspace`}
        >
          {t("message.actions.forkInNewWorkspace")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  triggerDisabled: {
    opacity: theme.opacity[50],
  },
  triggerSlot: {
    alignSelf: "center",
  },
  modeRow: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
