import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Split } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AgentForkMode } from "@getpaseo/protocol/agent-labels";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import type { Theme } from "@/styles/theme";

interface ForkMarkerProps {
  serverId: string;
  sourceAgentId: string;
  mode: AgentForkMode;
}

const ThemedSplit = withUnistyles(Split);
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

/** "Continued from chat" divider where a forked chat's own messages start. */
export const ForkMarker = memo(function ForkMarker({
  serverId,
  sourceAgentId,
  mode,
}: ForkMarkerProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const handlePress = useCallback(() => {
    router.push(buildHostAgentDetailRoute(serverId, sourceAgentId));
  }, [router, serverId, sourceAgentId]);

  return (
    <View style={styles.container} testID="fork-marker">
      <View style={styles.line} />
      <Pressable accessibilityRole="link" onPress={handlePress} style={styles.label}>
        <ThemedSplit size={12} uniProps={accentColorMapping} />
        <Text style={styles.text}>
          {mode === AgentForkMode.Full
            ? t("message.actions.forkContinuedFromChat")
            : t("message.actions.forkContinuedFromSummary")}
        </Text>
      </Pressable>
      <View style={styles.line} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  text: {
    fontFamily: theme.fontFamily.ui,
    fontSize: 13,
    color: theme.colors.accentBright,
  },
}));
