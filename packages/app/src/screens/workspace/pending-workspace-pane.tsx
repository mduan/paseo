import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  PendingWorkspaceCreationStatus,
  type PendingWorkspaceCreation,
} from "@/stores/pending-workspace-creation-store";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ELAPSED_TICK_MS = 1000;

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function useElapsed(input: { startedAt: number; ticking: boolean }): string {
  const { startedAt, ticking } = input;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(interval);
  }, [ticking]);
  return formatElapsed(now - startedAt);
}

/**
 * What a worktree workspace shows while its worktree is being built and the session store does not
 * have the workspace yet. It carries the sidebar toggle, so the user can leave while it waits.
 */
export function PendingWorkspacePane({
  entry,
  isActive,
  onDismiss,
}: {
  entry: PendingWorkspaceCreation;
  isActive: boolean;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const isFailed = entry.status === PendingWorkspaceCreationStatus.Failed;
  const elapsed = useElapsed({ startedAt: entry.startedAt, ticking: isActive && !isFailed });
  const headerLeft = useMemo(() => <SidebarMenuToggle />, []);

  return (
    <View style={styles.container} testID="pending-workspace-pane">
      <ScreenHeader left={headerLeft} borderless />
      <View style={styles.content}>
        <TitlebarDragRegion />
        <View style={styles.body}>
          {isFailed ? (
            <Alert
              variant="error"
              title={t("newWorkspace.errors.createWorktreeFailed")}
              description={entry.error}
              testID="pending-workspace-error"
            >
              <Button
                variant="outline"
                size="sm"
                onPress={onDismiss}
                testID="pending-workspace-dismiss"
              >
                {t("common.actions.dismiss")}
              </Button>
            </Alert>
          ) : (
            <View style={styles.progress}>
              <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
              <Text style={styles.title}>{t("workspace.pending.creating")}</Text>
              <Text style={styles.elapsed}>
                {t("workspace.pending.elapsed", { time: elapsed })}
              </Text>
            </View>
          )}
          {entry.promptPreview ? (
            <Text style={styles.prompt} numberOfLines={isFailed ? undefined : 6} selectable>
              {entry.promptPreview}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    position: "relative",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  body: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    gap: theme.spacing[4],
  },
  progress: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  elapsed: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  prompt: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
