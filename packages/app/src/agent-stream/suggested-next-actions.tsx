import { memo, useCallback } from "react";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { ArrowUp, MoreHorizontal, Pencil } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ToastApi } from "@/components/toast-host";
import { dispatchComposerAgentMessage } from "@/composer/actions";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { encodeImages } from "@/utils/encode-images";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import type { Theme } from "@/styles/theme";

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedPencil = withUnistyles(Pencil);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type PressableState = PressableStateCallbackType & { hovered?: boolean };

function chipSendStyle({ hovered, pressed }: PressableState) {
  return [styles.chipSend, (hovered || pressed) && styles.highlighted];
}

function chipEditStyle({ hovered, pressed }: PressableState) {
  return [styles.chipEdit, (hovered || pressed) && styles.highlighted];
}

function menuTriggerStyle({ hovered, pressed }: PressableState) {
  return [styles.menuTrigger, (hovered || pressed) && styles.highlighted];
}

/** Follow-up messages under the last completed turn: the chip sends, the pencil edits first. */
export const SuggestedNextActions = memo(function SuggestedNextActions({
  serverId,
  agentId,
  suggestions,
  onEdit,
  toast,
}: {
  serverId: string;
  agentId: string;
  suggestions: readonly string[];
  onEdit: (text: string) => void;
  toast: ToastApi;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useHostRuntimeClient(serverId);

  const send = useCallback(
    (text: string) => {
      if (!client) return;
      void dispatchComposerAgentMessage({
        client,
        agentId,
        text,
        attachments: [],
        encodeImages,
        submission: createMessageSubmissionWriter(serverId),
      }).catch((error) => toast.error(String(error)));
    },
    [agentId, client, serverId, toast],
  );

  const turnOff = useCallback(() => {
    if (!client) return;
    client
      .patchDaemonConfig({ metadataGeneration: { suggestedNextActions: { enabled: false } } })
      .then(() => toast.show(t("agentStream.suggestedNextActions.turnedOff")))
      .catch((error) => toast.error(String(error)));
  }, [client, t, toast]);

  const openSettings = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(serverId, "metadata"));
  }, [router, serverId]);

  return (
    <View style={styles.container} testID="suggested-next-actions">
      <View style={styles.header}>
        <Text style={styles.label}>{t("agentStream.suggestedNextActions.label")}</Text>
        <DropdownMenu>
          <DropdownMenuTrigger
            style={menuTriggerStyle}
            accessibilityRole="button"
            accessibilityLabel={t("agentStream.suggestedNextActions.options")}
          >
            <ThemedMoreHorizontal size={14} uniProps={mutedColorMapping} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" width={220}>
            <DropdownMenuItem onSelect={turnOff}>
              {t("agentStream.suggestedNextActions.turnOff")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={openSettings}>
              {t("agentStream.suggestedNextActions.settings")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {suggestions.map((suggestion) => (
        <SuggestionChip key={suggestion} text={suggestion} onSend={send} onEdit={onEdit} />
      ))}
    </View>
  );
});

function SuggestionChip({
  text,
  onSend,
  onEdit,
}: {
  text: string;
  onSend: (text: string) => void;
  onEdit: (text: string) => void;
}) {
  const { t } = useTranslation();
  const handleSend = useCallback(() => onSend(text), [onSend, text]);
  const handleEdit = useCallback(() => onEdit(text), [onEdit, text]);
  return (
    <View style={styles.chip}>
      <Pressable
        style={chipSendStyle}
        onPress={handleSend}
        accessibilityRole="button"
        accessibilityLabel={t("agentStream.suggestedNextActions.send", { text })}
      >
        <ThemedArrowUp size={14} uniProps={mutedColorMapping} />
        <Text style={styles.chipText} numberOfLines={1}>
          {text}
        </Text>
      </Pressable>
      <View style={styles.chipSeparator} />
      <Pressable
        style={chipEditStyle}
        onPress={handleEdit}
        accessibilityRole="button"
        accessibilityLabel={t("agentStream.suggestedNextActions.edit", { text })}
      >
        <ThemedPencil size={14} uniProps={mutedColorMapping} />
      </Pressable>
    </View>
  );
}

const CHIP_HEIGHT = 32;

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
    alignItems: "flex-start",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  menuTrigger: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "stretch",
    maxWidth: "100%",
    minHeight: CHIP_HEIGHT,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
  },
  chipSend: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
  },
  chipText: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  chipSeparator: {
    width: theme.borderWidth[1],
    backgroundColor: theme.colors.borderAccent,
  },
  chipEdit: {
    width: CHIP_HEIGHT + 2,
    alignItems: "center",
    justifyContent: "center",
  },
  highlighted: {
    backgroundColor: theme.colors.interactionHighlight,
  },
}));
