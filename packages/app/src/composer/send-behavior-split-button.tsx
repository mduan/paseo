import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SendBehavior } from "@/hooks/use-settings/storage";
import type { Theme } from "@/styles/theme";
import type { ShortcutKey } from "@/utils/format-shortcut";

type SendBehaviorSplitButtonProps<TBehavior extends SendBehavior> = Readonly<{
  /** Behavior the main segment sends with; it also labels the main segment. */
  primaryBehavior: TBehavior;
  behaviors: readonly TBehavior[];
  onPrimaryPress: () => void;
  onSelectBehavior: (behavior: TBehavior) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  /** Prefix for the trigger, menu, and item test IDs. */
  testID: string;
  primaryTestID?: string;
  tooltip?: ReactNode;
  shortcutFor?: (behavior: TBehavior) => ShortcutKey[][] | undefined;
}>;

/** Send button whose caret menu sends the same message with a different send behavior. */
export function SendBehaviorSplitButton<TBehavior extends SendBehavior>({
  primaryBehavior,
  behaviors,
  onPrimaryPress,
  onSelectBehavior,
  disabled = false,
  accessibilityLabel,
  testID,
  primaryTestID,
  tooltip,
  shortcutFor,
}: SendBehaviorSplitButtonProps<TBehavior>) {
  const { t } = useTranslation();
  const containerStyle = useMemo(() => [styles.container, disabled && styles.disabled], [disabled]);
  const caretStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.caret,
      (hovered || pressed || open) && styles.segmentActive,
    ],
    [],
  );
  const label = <Text style={styles.label}>{behaviorLabel(t, primaryBehavior)}</Text>;
  return (
    <View style={containerStyle}>
      {tooltip ? (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger
            onPress={onPrimaryPress}
            disabled={disabled}
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            testID={primaryTestID}
            style={styles.primary}
          >
            {label}
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        <Pressable
          onPress={onPrimaryPress}
          disabled={disabled}
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="button"
          testID={primaryTestID}
          style={styles.primary}
        >
          {label}
        </Pressable>
      )}
      <DropdownMenu compactMode="sheet">
        <DropdownMenuTrigger
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={t("composer.input.sendOptions")}
          testID={`${testID}-menu-trigger`}
          style={caretStyle}
        >
          <ThemedChevronDown size={14} uniProps={iconAccentForegroundMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          offset={8}
          minWidth={180}
          testID={`${testID}-menu`}
          sheetTitle={t("composer.input.sendOptions")}
        >
          {behaviors.map((behavior) => (
            <SendBehaviorMenuItem
              key={behavior}
              behavior={behavior}
              testID={`${testID}-${behavior}`}
              shortcut={shortcutFor?.(behavior)}
              onSelectBehavior={onSelectBehavior}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function SendBehaviorMenuItem<TBehavior extends SendBehavior>({
  behavior,
  testID,
  shortcut,
  onSelectBehavior,
}: {
  behavior: TBehavior;
  testID: string;
  shortcut: ShortcutKey[][] | undefined;
  onSelectBehavior: (behavior: TBehavior) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelectBehavior(behavior), [behavior, onSelectBehavior]);
  const trailing = useMemo(() => (shortcut ? <Shortcut chord={shortcut} /> : null), [shortcut]);
  return (
    <DropdownMenuItem testID={testID} trailing={trailing} onSelect={handleSelect}>
      {behaviorLabel(t, behavior)}
    </DropdownMenuItem>
  );
}

function behaviorLabel(t: ReturnType<typeof useTranslation>["t"], behavior: SendBehavior): string {
  return t(`settings.general.defaultSend.options.${behavior}`);
}

const styles = StyleSheet.create((theme) => ({
  container: {
    height: 28,
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    overflow: "hidden",
  },
  disabled: {
    opacity: 0.5,
  },
  primary: {
    justifyContent: "center",
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accentForeground,
  },
  caret: {
    width: 26,
    alignItems: "center",
    justifyContent: "center",
    paddingRight: 2,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.accentBright,
  },
  segmentActive: {
    backgroundColor: theme.colors.accentBright,
  },
}));

const ThemedChevronDown = withUnistyles(ChevronDown);
const iconAccentForegroundMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
