import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Diff, FileDiff, GitCommitHorizontal, Maximize } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  PaneContentToolbar,
  ToolbarButton,
  paneContentToolbarTrailingPadding,
} from "@/components/ui/pane-content-toolbar";
import { isWeb } from "@/constants/platform";
import { useDiffContextExpansion } from "@/git/diff-context-expansion";
import { useReviewDraftScope } from "@/git/use-working-diff";
import { useInlineReviewController } from "@/review";
import { buildDiffReviewContext } from "@/review/context";
import type { ReviewLineRange } from "@/review/range";
import { DiffDocument } from "@/git/diff-document";
import {
  ChangesDiffToolbar,
  ChangesSurface,
  DiffLayoutToggle,
  resolveDiffLayout,
  type ChangesToolbarDiffOptions,
} from "@/git/diff-pane";
import { useCommitDiffFiles } from "@/git/use-diff-files";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { useAppSettings } from "@/hooks/use-settings";
import { usePaneContext } from "@/panels/pane-context";
import {
  definePanel,
  type PanelDescriptor,
  type PanelDescriptorContext,
  type PanelPresentation,
} from "@/panels/panel-registry";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { moveWorkspaceTabToMain } from "@/workspace-tabs/open-beside";
import { findPaneContainingTab, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { defaultChangesState, changesStateSchema } from "@/panels/changes/state";
import { usePanelState } from "@/panels/use-panel-state";
import { RenderProfile } from "@/utils/render-profiler";
import type { Theme } from "@/styles/theme";
import { useAgentTurnDiff, useAgentTurnDiffs } from "@/turn-diffs/queries";

const ThemedFileDiff = withUnistyles(FileDiff);
const ThemedGitCommitHorizontal = withUnistyles(GitCommitHorizontal);
const ThemedDiff = withUnistyles(Diff);
const ThemedMaximize = withUnistyles(Maximize);
const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function useDiffPanelPreferences() {
  const { settings } = useAppSettings();
  const { preferences, updatePreferences } = useChangesPreferences();
  const isCompact = useIsCompactFormFactor();
  const canUseSplitLayout = isWeb && !isCompact;
  const effectiveLayout = resolveDiffLayout(preferences.layout, canUseSplitLayout);
  const displayPreferences = useMemo(
    () => ({
      layout: effectiveLayout,
      wrapLines: preferences.wrapLines,
      codeFontSize: settings.codeFontSize,
      monoFontFamily: settings.monoFontFamily,
    }),
    [effectiveLayout, preferences.wrapLines, settings.codeFontSize, settings.monoFontFamily],
  );
  const toggleLayout = useCallback(() => {
    void updatePreferences({ layout: preferences.layout === "unified" ? "split" : "unified" });
  }, [preferences.layout, updatePreferences]);
  const toggleWrapLines = useCallback(() => {
    void updatePreferences({ wrapLines: !preferences.wrapLines });
  }, [preferences.wrapLines, updatePreferences]);
  const toggleHideWhitespace = useCallback(() => {
    void updatePreferences({ hideWhitespace: !preferences.hideWhitespace });
  }, [preferences.hideWhitespace, updatePreferences]);
  return {
    preferences,
    isCompact,
    canUseSplitLayout,
    displayPreferences,
    toggleLayout,
    toggleWrapLines,
    toggleHideWhitespace,
  };
}

function PanelState({
  message,
  tone = "muted",
  testID,
}: {
  message: string;
  tone?: "muted" | "error";
  testID?: string;
}) {
  return (
    <View style={styles.centerState} testID={testID}>
      <Text style={tone === "error" ? styles.errorText : styles.mutedText}>{message}</Text>
    </View>
  );
}

function resolveChangesPresentation(
  isTree: boolean,
  inlineDiff: boolean,
): "tree" | "diff" | "combined" {
  if (!isTree) return "diff";
  return inlineDiff ? "combined" : "tree";
}

function ChangesPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, tabId, target, openPreferredTarget, openTargetToSide } =
    usePaneContext();
  const [changesState, setChangesState] = usePanelState(changesStateSchema, defaultChangesState);
  const { preferences } = useChangesPreferences();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const isActive = useRetainedPanelActive();
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  invariant(
    target.kind === "working_diff" || target.kind === "changes_tree",
    "ChangesPanel requires working_diff or changes_tree target",
  );
  const isTree = target.kind === "changes_tree";

  const handleOpenFile = useCallback(
    (path: string) => openPreferredTarget({ kind: "file", path }, isTree ? "diffs" : "diffFiles"),
    [isTree, openPreferredTarget],
  );

  const handleSelectDiffFile = useCallback(
    (path: string) =>
      openPreferredTarget(
        { kind: "working_diff", focusPath: path, focusRequestId: Date.now() },
        "diffs",
      ),
    [openPreferredTarget],
  );
  const handleOpenDiffToSide = useCallback(
    (path: string) =>
      openTargetToSide?.({ kind: "working_diff", focusPath: path, focusRequestId: Date.now() }),
    [openTargetToSide],
  );

  if (!cwd) {
    return <PanelState message={t("panels.diff.directoryMissing")} />;
  }

  const presentation = resolveChangesPresentation(isTree, preferences.inlineDiff);
  const testID = isTree ? "changes-tree-panel" : "working-diff-panel";
  const profileId = isTree ? `ChangesTreePanel:${tabId}` : `WorkingDiffPanel:${tabId}`;

  return (
    <View style={styles.container} testID={testID}>
      <RenderProfile id={profileId}>
        <ChangesSurface
          serverId={serverId}
          workspaceId={workspaceId}
          cwd={cwd}
          enabled={isActive}
          presentation={presentation}
          focusPath={target.kind === "working_diff" ? target.focusPath : undefined}
          focusRequestId={target.kind === "working_diff" ? target.focusRequestId : undefined}
          onSelectDiffFile={isTree ? handleSelectDiffFile : undefined}
          onOpenFile={handleOpenFile}
          onOpenToSide={isTree && openTargetToSide ? handleOpenDiffToSide : undefined}
          onAddToChat={canAddToChat ? addFile : undefined}
          state={changesState}
          onStateChange={setChangesState}
        />
      </RenderProfile>
    </View>
  );
}

const EMPTY_FILES: ParsedDiffFile[] = [];

function CommitDiffPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const panelPreferences = useDiffPanelPreferences();
  invariant(target.kind === "commit_diff", "CommitDiffPanel requires commit_diff target");
  const { files, isLoading, error, capabilityMissing } = useCommitDiffFiles({
    serverId,
    cwd: cwd ?? "",
    sha: target.sha,
    enabled: Boolean(cwd),
  });
  const mode = useMemo(() => ({ kind: "commit" as const }), []);
  const expansion = useDiffContextExpansion({
    serverId,
    cwd: cwd ?? "",
    scopeKey: `commit:${serverId}:${cwd}:${target.sha}`,
    files,
  });

  let body: ReactNode;
  if (!cwd) {
    body = <PanelState message={t("panels.diff.directoryMissing")} />;
  } else if (capabilityMissing) {
    body = (
      <PanelState
        message={t("panels.diff.capabilityMissing")}
        testID="commit-diff-capability-missing"
      />
    );
  } else if (error) {
    body = (
      <PanelState message={t("panels.diff.loadError")} tone="error" testID="commit-diff-error" />
    );
  } else if (isLoading && files.length === 0) {
    body = <PanelState message={t("workspace.tabs.loading")} testID="commit-diff-loading" />;
  } else if (files.length === 0) {
    body = <PanelState message={t("panels.diff.empty")} testID="commit-diff-empty" />;
  } else {
    body = (
      <DiffDocument
        files={expansion.files}
        displayPreferences={panelPreferences.displayPreferences}
        mode={mode}
        onExpandGap={expansion.onExpandGap}
      />
    );
  }

  return (
    <View style={styles.container} testID="commit-diff-panel">
      {panelPreferences.canUseSplitLayout ? (
        <PaneContentToolbar
          style={[
            styles.toolbar,
            {
              paddingRight: paneContentToolbarTrailingPadding(panelPreferences.isCompact, "glyph"),
            },
          ]}
          testID="commit-diff-header"
        >
          <View style={styles.toolbarActions} testID="commit-diff-toolbar">
            <DiffLayoutToggle
              layout={panelPreferences.preferences.layout}
              isMobile={panelPreferences.isCompact}
              testID="commit-diff-toggle-layout"
              onToggle={panelPreferences.toggleLayout}
            />
          </View>
        </PaneContentToolbar>
      ) : null}
      <View style={styles.body}>{body}</View>
    </View>
  );
}

function TurnDiffPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, host, tabId, target, openPreferredTarget } = usePaneContext();
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const isInSidePane = useWorkspaceLayoutStore((state) => {
    const layout = workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined;
    const sidePaneId = workspaceKey ? state.sidePaneIdByWorkspace[workspaceKey] : undefined;
    return Boolean(
      layout && sidePaneId && findPaneContainingTab(layout.root, tabId)?.id === sidePaneId,
    );
  });
  const canOpenInMainPanel = host === "explorer" || isInSidePane;
  const handleOpenInMainPanel = useCallback(() => {
    if (workspaceKey) moveWorkspaceTabToMain({ workspaceKey, tabId });
  }, [tabId, workspaceKey]);
  const isActive = useRetainedPanelActive();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const { reviewDraftKey } = useReviewDraftScope({ serverId, workspaceId, cwd: cwd ?? "" });
  const panelPreferences = useDiffPanelPreferences();
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  const [collapsedFilePaths, setCollapsedFilePaths] = useState<string[]>([]);
  invariant(target.kind === "turn_diff", "TurnDiffPanel requires turn_diff target");
  const turnTarget = useMemo(() => ({ kind: "turn" as const, turnId: target.turnId }), [target]);
  const query = useAgentTurnDiff({
    serverId,
    agentId: target.agentId,
    target: turnTarget,
    ignoreWhitespace: panelPreferences.preferences.hideWhitespace,
    enabled: isActive,
  });
  const handleOpenFile = useCallback(
    (path: string) => openPreferredTarget({ kind: "file", path }, "diffs"),
    [openPreferredTarget],
  );
  const collapseState = useMemo(
    () => ({ paths: collapsedFilePaths, onChange: setCollapsedFilePaths }),
    [collapsedFilePaths],
  );

  const payload = query.data;
  const files = payload?.files ?? EMPTY_FILES;
  const diffOptions = useMemo<ChangesToolbarDiffOptions>(
    () => ({
      collapse:
        files.length > 0
          ? {
              allFilesCollapsed: files.every((file) => collapsedFilePaths.includes(file.path)),
              onCollapseAll: () => setCollapsedFilePaths(files.map((file) => file.path)),
              onExpandAll: () => setCollapsedFilePaths([]),
            }
          : null,
      layout: panelPreferences.canUseSplitLayout
        ? {
            value: panelPreferences.preferences.layout,
            onToggle: panelPreferences.toggleLayout,
          }
        : null,
      hideWhitespace: panelPreferences.preferences.hideWhitespace,
      wrapLines: panelPreferences.preferences.wrapLines,
      onToggleHideWhitespace: panelPreferences.toggleHideWhitespace,
      onToggleWrapLines: panelPreferences.toggleWrapLines,
    }),
    [collapsedFilePaths, files, panelPreferences],
  );
  const expansion = useDiffContextExpansion({
    serverId,
    cwd: payload?.cwd ?? "",
    scopeKey: `turn:${serverId}:${target.agentId}:${target.turnId}:${panelPreferences.preferences.hideWhitespace}`,
    files,
  });
  const buildContext = useCallback(
    (range: ReviewLineRange) => buildDiffReviewContext({ range, diffFiles: expansion.files }),
    [expansion.files],
  );
  const reviewActions = useInlineReviewController({
    reviewDraftKey,
    buildContext,
    snapshot: payload?.snapshot,
  });
  const mode = useMemo(
    () => ({
      kind: "working" as const,
      reviewActions: payload?.snapshot ? reviewActions : undefined,
      focusPath: target.focusPath,
      focusRequestId: target.focusRequestId,
      onOpenFile: handleOpenFile,
      onAddToChat: canAddToChat ? addFile : undefined,
    }),
    [
      addFile,
      canAddToChat,
      handleOpenFile,
      payload?.snapshot,
      reviewActions,
      target.focusPath,
      target.focusRequestId,
    ],
  );
  let body: ReactNode;
  if (query.error) {
    body = <PanelState message={t("panels.diff.loadError")} tone="error" />;
  } else if (!payload) {
    body = <PanelState message={t("workspace.tabs.loading")} />;
  } else if (!payload.available) {
    body = <PanelState message={t("workspace.git.diff.noTurnSnapshot")} />;
  } else if (payload.error) {
    body = <PanelState message={payload.error.message} tone="error" />;
  } else if (payload.files.length === 0) {
    body = <PanelState message={t("panels.diff.empty")} />;
  } else {
    body = (
      <DiffDocument
        files={expansion.files}
        displayPreferences={panelPreferences.displayPreferences}
        mode={mode}
        collapseState={collapseState}
        onExpandGap={expansion.onExpandGap}
      />
    );
  }

  const commentsCapabilityMissing = payload?.available && !payload.snapshot && files.length > 0;
  return (
    <View style={styles.container} testID="turn-diff-panel">
      <PaneContentToolbar
        style={[
          styles.toolbar,
          { paddingRight: paneContentToolbarTrailingPadding(panelPreferences.isCompact, "glyph") },
        ]}
      >
        <View style={styles.toolbarActions}>
          <ChangesDiffToolbar options={diffOptions} compact={panelPreferences.isCompact} />
          {canOpenInMainPanel ? (
            <ToolbarButton
              label={t("workspace.tabs.menu.moveToMain")}
              onPress={handleOpenInMainPanel}
              testID="turn-diff-open-in-main"
            >
              <ThemedMaximize size={14} uniProps={mutedIconColorMapping} />
            </ToolbarButton>
          ) : null}
        </View>
      </PaneContentToolbar>
      {commentsCapabilityMissing ? (
        <Text style={styles.mutedText} testID="turn-diff-comments-capability-missing">
          {t("panels.diff.commentsCapabilityMissing")}
        </Text>
      ) : null}
      <View style={styles.body}>{body}</View>
    </View>
  );
}

function useTurnDiffPanelDescriptor(
  target: Extract<WorkspaceTabTarget, { kind: "turn_diff" }>,
  context: PanelDescriptorContext,
): PanelDescriptor {
  const { t } = useTranslation();
  const turns = useAgentTurnDiffs({
    serverId: context.serverId,
    agentId: target.agentId,
    enabled: true,
  });
  const completedAt = turns.find((turn) => turn.turnId === target.turnId)?.completedAt;
  const time = completedAt
    ? new Date(completedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  return {
    label: time ? t("panels.diff.turnLabel", { time }) : t("panels.diff.turnSubtitle"),
    subtitle: t("panels.diff.turnSubtitle"),
    tooltip: t("panels.diff.turnSubtitle"),
    titleState: "ready",
    icon: ThemedDiff,
    statusBucket: null,
  };
}

const workingDiffPresentation = {
  label: (t) => t("panels.diff.diffLabel"),
  subtitle: (t) => t("panels.diff.changesSubtitle"),
  tooltip: (t) => t("panels.diff.changesSubtitle"),
  icon: ThemedFileDiff,
} satisfies PanelPresentation;

const changesTreePresentation = {
  label: (t) => t("panels.diff.changesLabel"),
  subtitle: (t) => t("panels.diff.changesSubtitle"),
  tooltip: (t) => t("panels.diff.changesSubtitle"),
  icon: ThemedFileDiff,
} satisfies PanelPresentation;

function useCommitDiffPanelDescriptor(
  target: Extract<WorkspaceTabTarget, { kind: "commit_diff" }>,
): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: target.sha.slice(0, 7),
    subtitle: t("panels.diff.commitSubtitle"),
    tooltip: target.sha,
    titleState: "ready",
    icon: ThemedGitCommitHorizontal,
    statusBucket: null,
  };
}

export const workingDiffPanelRegistration = definePanel("working_diff", {
  component: ChangesPanel,
  presentation: workingDiffPresentation,
});

export const changesTreePanelRegistration = definePanel("changes_tree", {
  component: ChangesPanel,
  presentation: changesTreePresentation,
});

export const commitDiffPanelRegistration = definePanel("commit_diff", {
  component: CommitDiffPanel,
  useDescriptor: useCommitDiffPanelDescriptor,
});

export const turnDiffPanelRegistration = definePanel("turn_diff", {
  component: TurnDiffPanel,
  useDescriptor: useTurnDiffPanelDescriptor,
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flex: 1,
    gap: 1,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[16],
  },
  mutedText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.destructive,
    textAlign: "center",
  },
}));
