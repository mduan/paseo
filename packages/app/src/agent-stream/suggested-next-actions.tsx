import { memo, useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ArrowUp, Pencil } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ToastApi } from "@/components/toast-host";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { dispatchComposerAgentMessage } from "@/composer/actions";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { encodeImages } from "@/utils/encode-images";

/** Follow-up messages under the last completed turn. Each row can be sent now or edited in the composer first. */
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
      <View style={styles.card}>
        {suggestions.map((suggestion, index) => (
          <View key={suggestion} style={index > 0 && styles.rowDivider}>
            <SuggestionRow text={suggestion} onSend={send} onEdit={onEdit} />
          </View>
        ))}
      </View>
    </View>
  );
});

function SuggestionRow({
  text,
  onSend,
  onEdit,
}: {
  text: string;
  onSend: (text: string) => void;
  onEdit: (text: string) => void;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const handleSend = useCallback(() => onSend(text), [onSend, text]);
  const handleEdit = useCallback(() => onEdit(text), [onEdit, text]);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const showActions = isHovered || isFocused || isNative || isCompact;
  return (
    <View
      style={styles.rowHoverTarget}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <View style={[styles.row, isCompact && styles.rowCompact, isHovered && styles.highlighted]}>
        <Text
          style={[styles.rowText, isCompact && styles.rowTextCompact]}
          numberOfLines={isCompact ? undefined : 1}
        >
          {text}
        </Text>
        <View
          style={[styles.rowActions, !showActions && styles.hidden]}
          pointerEvents={showActions ? "auto" : "none"}
        >
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Pencil}
            onPress={handleEdit}
            onFocus={handleFocus}
            onBlur={handleBlur}
            accessibilityLabel={t("agentStream.suggestedNextActions.edit", { text })}
          >
            {t("agentStream.suggestedNextActions.editButton")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={ArrowUp}
            onPress={handleSend}
            onFocus={handleFocus}
            onBlur={handleBlur}
            accessibilityLabel={t("agentStream.suggestedNextActions.send", { text })}
          >
            {t("agentStream.suggestedNextActions.sendButton")}
          </Button>
        </View>
      </View>
    </View>
  );
}

const ROW_MIN_HEIGHT = 44;

const styles = StyleSheet.create((theme) => ({
  container: {
    marginTop: theme.spacing[4],
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  card: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.xl,
    overflow: "hidden",
  },
  rowHoverTarget: {
    position: "relative",
  },
  rowDivider: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.borderAccent,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: ROW_MIN_HEIGHT,
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[1],
  },
  rowCompact: {
    flexWrap: "wrap",
    paddingVertical: theme.spacing[2],
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  rowTextCompact: {
    flexBasis: "100%",
  },
  rowActions: {
    flexDirection: "row",
    gap: theme.spacing[1],
    marginLeft: "auto",
  },
  hidden: {
    opacity: 0,
  },
  highlighted: {
    backgroundColor: theme.colors.interactionHighlight,
  },
}));
