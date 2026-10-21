/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
import { useMemo, type PropsWithChildren } from "react";
import { Image, Text, View } from "react-native";
import { Box, UserRound } from "lucide-react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { LinearIssueStateType, type LinearTicket } from "@getpaseo/protocol/messages";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const METADATA_SIZE = ICON_SIZE.lg;
const ThemedUser = withUnistyles(UserRound);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function MetadataTooltip({ label, children }: PropsWithChildren<{ label: string }>) {
  return (
    <Tooltip enabledOnMobile>
      <TooltipTrigger accessibilityLabel={label} style={styles.trigger}>
        {children}
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.tooltip}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function LinearTicketMetadata({ ticket }: { ticket: LinearTicket }) {
  const { t } = useTranslation();
  const { state, assignee, project } = ticket;
  const imageSource = useMemo(
    () => (assignee?.avatarUrl ? { uri: assignee.avatarUrl } : undefined),
    [assignee?.avatarUrl],
  );
  if (!state) return null;

  const completed = state.type === LinearIssueStateType.Completed;
  const dashed =
    state.type === LinearIssueStateType.Backlog || state.type === LinearIssueStateType.Triage;
  const assigneeName = assignee?.name || t("workspace.hoverCard.unassigned");

  return (
    <View style={styles.metadata}>
      <MetadataTooltip label={state.name}>
        <Svg width={METADATA_SIZE} height={METADATA_SIZE} viewBox="1 1 22 22">
          <Circle
            cx={12}
            cy={12}
            r={10}
            stroke={state.color}
            strokeWidth={2}
            strokeDasharray={dashed ? "3 3" : undefined}
            fill={completed ? state.color : "none"}
          />
          {state.type === LinearIssueStateType.Started && (
            <Path d="M12 5 A7 7 0 0 1 12 19 Z" fill={state.color} />
          )}
          {completed && (
            <Path
              d="m7 12 3.5 3.5L17 9"
              fill="none"
              stroke="white"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {state.type === LinearIssueStateType.Canceled && (
            <Path d="m8 8 8 8m0-8-8 8" stroke={state.color} strokeWidth={2} strokeLinecap="round" />
          )}
        </Svg>
      </MetadataTooltip>
      <MetadataTooltip label={assigneeName}>
        {assignee ? (
          <View style={styles.avatar}>
            <Text style={styles.initial}>{assignee.name.slice(0, 1).toUpperCase()}</Text>
            {imageSource && <Image source={imageSource} style={styles.photo} />}
          </View>
        ) : (
          <View style={styles.unassigned}>
            <ThemedUser size={12} uniProps={mutedIcon} />
          </View>
        )}
      </MetadataTooltip>
      {project && (
        <View style={styles.project}>
          <Tooltip enabledOnMobile>
            <TooltipTrigger style={styles.projectTrigger} accessibilityLabel={project.name}>
              <Box size={12} color={project.color} style={styles.projectIcon} />
              <Text style={styles.projectName} numberOfLines={1}>
                {project.name}
              </Text>
            </TooltipTrigger>
            <TooltipContent>
              <Text style={styles.tooltip}>{project.name}</Text>
            </TooltipContent>
          </Tooltip>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  metadata: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    flexShrink: 1,
    minWidth: 0,
  },
  trigger: {
    height: 22,
    minWidth: METADATA_SIZE,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tooltip: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  avatar: {
    width: METADATA_SIZE,
    height: METADATA_SIZE,
    borderRadius: theme.borderRadius.full,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface3,
  },
  initial: { fontSize: 10, color: theme.colors.foregroundMuted },
  photo: { position: "absolute", width: "100%", height: "100%" },
  unassigned: {
    width: METADATA_SIZE,
    height: METADATA_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.foregroundExtraMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  project: { flexShrink: 1, minWidth: 0 },
  projectIcon: { flexShrink: 0 },
  projectTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[1.5],
    height: METADATA_SIZE,
    minWidth: 0,
  },
  projectName: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
    minWidth: 0,
  },
}));
