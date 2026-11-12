import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronLeft, CornerUpLeft } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { composerPillStyles } from "@/composer/pill-styles";
import { ComposerTrackMark } from "@/composer/tracks";
import { useFetchQuery } from "@/data/query";
import { useAgentPanelDescriptor } from "@/panels/agent-panel-descriptor";
import type { PanelDescriptor } from "@/panels/panel-registry";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { storeFetchedAgentDetail } from "@/utils/store-fetched-agent-detail";

const ThemedChevronLeft = withUnistyles(ChevronLeft);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/** The parent of a managed agent, or undefined for a root or detached agent. */
export function useParentAgentId(serverId: string, agentId: string): string | undefined {
  return useSessionStore((state) => {
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return agent?.parentAgentId ?? undefined;
  });
}

/** The parent as its own tab presents it, and the way back to it wherever it lives. */
function useParentAgent(serverId: string, parentAgentId: string) {
  const { t } = useTranslation();
  const descriptor = useAgentPanelDescriptor(
    { kind: "agent", agentId: parentAgentId },
    { serverId },
  );
  const isCached = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return Boolean(session?.agents.has(parentAgentId) || session?.agentDetails.has(parentAgentId));
  });
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  // An archived or unloaded parent is not in the store; fetch it once so its title and status show.
  useFetchQuery({
    queryKey: ["subagentParent", serverId, parentAgentId],
    queryFn: async () => {
      const result = await client?.fetchAgent({ agentId: parentAgentId });
      if (result) {
        storeFetchedAgentDetail({ serverId, result });
      }
      return result?.agent.id ?? null;
    },
    enabled: !isCached && Boolean(client) && isConnected,
    retry: false,
    dataShape: "value",
    staleTimeMs: 0,
  });
  const open = useCallback(() => {
    navigateToAgent({ serverId, agentId: parentAgentId });
  }, [parentAgentId, serverId]);
  return {
    label: descriptor.label || t("subagents.parent.parentAgent"),
    icon: descriptor.icon,
    statusBucket: descriptor.statusBucket,
    open,
  };
}

/** Leads the composer track rail of an interactive subagent: the parent's title and the way back. */
export function ParentAgentPill({
  serverId,
  parentAgentId,
}: {
  serverId: string;
  parentAgentId: string;
}): ReactElement {
  const { t } = useTranslation();
  const parent = useParentAgent(serverId, parentAgentId);
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const bodyStyle = useMemo(
    () => [composerPillStyles.body, styles.pill, isHovered && composerPillStyles.bodyActive],
    [isHovered],
  );
  const labelStyle = useMemo(
    () => [composerPillStyles.label, styles.pillLabel, isHovered && composerPillStyles.labelActive],
    [isHovered],
  );

  return (
    <Pressable
      testID="composer-parent-agent-pill"
      accessibilityRole="button"
      accessibilityLabel={t("subagents.parent.backTo", { label: parent.label })}
      onPress={parent.open}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={bodyStyle}
    >
      <ThemedChevronLeft
        size={14}
        uniProps={isHovered ? foregroundColorMapping : mutedColorMapping}
      />
      <ComposerTrackMark bucket={parent.statusBucket} />
      <Text style={labelStyle} numberOfLines={1}>
        {parent.label}
      </Text>
    </Pressable>
  );
}

function ParentIcon({
  icon: Icon,
  color = "",
}: {
  icon: PanelDescriptor["icon"];
  color?: string;
}): ReactElement {
  return <Icon size={18} color={color} />;
}

const ThemedParentIcon = withUnistyles(ParentIcon);

/** Sits below a read-only subagent's transcript, where a composer would be. */
export function ParentAgentCard({
  serverId,
  parentAgentId,
}: {
  serverId: string;
  parentAgentId: string;
}): ReactElement {
  const { t } = useTranslation();
  const parent = useParentAgent(serverId, parentAgentId);

  return (
    <View style={styles.cardRail}>
      <View style={styles.card} testID="parent-agent-card">
        <View style={styles.avatar}>
          <ThemedParentIcon icon={parent.icon} uniProps={foregroundColorMapping} />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.eyebrow}>{t("subagents.parent.parent")}</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {parent.label}
            </Text>
            <ComposerTrackMark bucket={parent.statusBucket} />
          </View>
        </View>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={CornerUpLeft}
          onPress={parent.open}
          testID="parent-agent-card-open"
        >
          {t("subagents.parent.openParent")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    flexShrink: 1,
    minWidth: 0,
    gap: theme.spacing[1.5],
    paddingLeft: theme.spacing[2],
  },
  pillLabel: {
    flexShrink: 1,
    maxWidth: { xs: 140, md: 240 },
  },
  cardRail: {
    alignItems: "center",
    width: "100%",
    padding: theme.spacing[4],
  },
  card: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius["2xl"],
    padding: theme.spacing[3],
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  eyebrow: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
}));
