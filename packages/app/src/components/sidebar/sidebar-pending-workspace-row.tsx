import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { TriangleAlert, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { isWeb } from "@/constants/platform";
import {
  PendingWorkspaceCreationStatus,
  type PendingWorkspaceCreation,
} from "@/stores/pending-workspace-creation-store";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const ThemedX = withUnistyles(X);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

/**
 * A worktree that is still being created. It takes a workspace row's place under its project until
 * the workspace reaches the session store, so the sidebar has the row from the moment creation is
 * accepted. Press and dismiss are separate siblings so neither nests inside the other's Pressable.
 */
export function SidebarPendingWorkspaceRow({
  entry,
  selected,
  onPress,
  onDismiss,
}: {
  entry: PendingWorkspaceCreation;
  selected: boolean;
  onPress: (entry: PendingWorkspaceCreation) => void;
  onDismiss: (entry: PendingWorkspaceCreation) => void;
}) {
  const { t } = useTranslation();
  const isFailed = entry.status === PendingWorkspaceCreationStatus.Failed;
  const handlePress = useCallback(() => onPress(entry), [entry, onPress]);
  const handleDismiss = useCallback(() => onDismiss(entry), [entry, onDismiss]);
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      isFailed && styles.rowFailed,
      selected && styles.rowSelected,
      hovered && !pressed && !selected && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFailed, selected],
  );

  return (
    <View style={styles.container} testID={`sidebar-pending-workspace-${entry.workspaceId}`}>
      <Pressable
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={entry.title}
        onPress={handlePress}
        style={rowStyle}
      >
        <View style={styles.iconSlot}>
          {isFailed ? (
            <ThemedTriangleAlert size={14} uniProps={dangerColorMapping} />
          ) : (
            <ThemedLoadingSpinner size={14} uniProps={foregroundMutedColorMapping} />
          )}
        </View>
        <Text style={selected ? styles.titleSelected : styles.title} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={isFailed ? styles.statusFailed : styles.status} numberOfLines={1}>
          {isFailed ? t("sidebar.workspace.status.failed") : t("sidebar.workspace.status.creating")}
        </Text>
      </Pressable>
      {isFailed ? (
        <View style={styles.dismissSlot} pointerEvents="box-none">
          <Pressable
            accessibilityRole={isWeb ? undefined : "button"}
            accessibilityLabel={t("common.actions.dismiss")}
            onPress={handleDismiss}
            style={styles.dismissButton}
            testID={`sidebar-pending-workspace-dismiss-${entry.workspaceId}`}
          >
            <ThemedX size={14} uniProps={foregroundMutedColorMapping} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
    marginBottom: theme.spacing[0.5],
  },
  // Kept in step with `workspaceRow` in sidebar-workspace-list.tsx.
  row: {
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  // Room for the dismiss button, which floats over the row's right edge.
  rowFailed: {
    paddingRight: theme.spacing[8] + theme.spacing[2],
  },
  rowSelected: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  // The width of a workspace row's status slot, so the title lands on the rail of the rows around it.
  iconSlot: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    minWidth: 0,
    flexShrink: 1,
  },
  titleSelected: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    minWidth: 0,
    flexShrink: 1,
  },
  status: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
  statusFailed: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
  dismissSlot: {
    position: "absolute",
    top: 0,
    right: theme.spacing[2],
    bottom: 0,
    justifyContent: "center",
  },
  dismissButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
}));
