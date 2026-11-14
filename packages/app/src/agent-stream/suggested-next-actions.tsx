import { memo, useCallback } from "react";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ToastApi } from "@/components/toast-host";
import { dispatchComposerAgentMessage } from "@/composer/actions";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { encodeImages } from "@/utils/encode-images";
import type { Theme } from "@/styles/theme";

const ThemedPencil = withUnistyles(Pencil);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type PressableState = PressableStateCallbackType & { hovered?: boolean };

function chipSendStyle({ hovered, pressed }: PressableState) {
  return [styles.chipSend, (hovered || pressed) && styles.highlighted];
}

function chipEditStyle({ hovered, pressed }: PressableState) {
  return [styles.chipEdit, (hovered || pressed) && styles.highlighted];
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

  return (
    <View style={styles.container} testID="suggested-next-actions">
      <Text style={styles.label}>{t("agentStream.suggestedNextActions.label")}</Text>
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
        <Text style={styles.chipText}>{text}</Text>
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
    marginTop: theme.spacing[4],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[2],
    alignItems: "flex-start",
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "stretch",
    maxWidth: "100%",
    minHeight: CHIP_HEIGHT,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
  },
  chipSend: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
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
    backgroundColor: theme.colors.surface2,
  },
}));
