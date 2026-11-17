import { CheckoutDiffHistoryStatus } from "@getpaseo/protocol/messages";
import { useState, useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { TreeRail } from "@/components/tree-rail";
import { TreeRailToggle } from "@/components/tree-rail-toggle";
import { DiffStat } from "@/components/diff-stat";
import {
  View,
  Text,
  Pressable,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  AlignJustify,
  ChevronDown,
  Columns2,
  ListChevronsDownUp,
  ListChevronsUpDown,
  MoreHorizontal,
  Pilcrow,
  RotateCw,
  WrapText,
} from "lucide-react-native";
import { type ParsedDiffFile } from "@/git/use-diff-query";
import type { ChangesState } from "@/panels/changes/state";
import { defaultChangesState } from "@/panels/changes/state";
import { DiffDocument, type WorkingDiffMode } from "@/git/diff-document";
import { ChangedFilesTree } from "@/git/changed-files-tree";
import { JUMP_TO_FILE_CLEARANCE, JumpToFile } from "@/git/jump-to-file";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import {
  CommitRangeMenuSection,
  formatCommitRange,
  useWorkspaceCommits,
} from "@/git/commit-range/commit-range-menu";
import { commitRangeSpan } from "@/git/commit-range/commit-range";
import { sumDiffStat } from "@/git/file-header-presentation";
import { useAppSettings } from "@/hooks/use-settings";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as Clipboard from "expo-clipboard";
import { useFileDownload } from "@/hooks/use-file-download";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { GitActionsSplitButton } from "@/git/actions-split-button";
import type { GitActions } from "@/git/policy";
import { BaseRefSwitcher } from "@/components/base-ref-switcher";
import { useGitActions } from "@/git/use-actions";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { buildForgeSignInCommand, getForgePresentation, type Forge } from "@/git/forge";
import { parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";
import type { ForgeAuthState } from "@getpaseo/protocol/messages";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Button } from "@/components/ui/button";
import {
  PaneContentToolbar,
  paneContentToolbarIconSize,
  paneContentToolbarIconButtonStyle,
  paneContentToolbarTrailingPadding,
  type ToolbarTrailingControl,
  ToolbarButton,
  ToolbarControls,
} from "@/components/ui/pane-content-toolbar";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import {
  isToolbarLabelTriggerHighlighted,
  ToolbarLabelTriggerIcon,
  toolbarLabelTriggerTextStyle,
  toolbarLabelTriggerFrameStyle,
  toolbarLabelTriggerStyle,
} from "@/components/ui/toolbar-label-trigger";
import { isWeb } from "@/constants/platform";
import { useWorkingDiff } from "@/git/use-working-diff";
import type { CheckoutStatusPayload } from "@/git/use-status-query";
import {
  DiffTooLargeState,
  LargeDiffGate,
  type DiffComparisonRefs,
} from "@/git/diff-too-large-state";
import { useRevealInFileManager } from "@/workspace/open-in-file-manager/reveal";
import {
  LiveDiffComparison,
  isSnapshotDiffComparison,
  type CommitRange,
  type CommitRangeComparison,
  type WorkingDiffComparison,
} from "@/git/working-diff-comparison/state";

export type { GitActionId, GitAction, GitActions } from "@/git/policy";

export function resolveDiffLayout(
  layout: "unified" | "split",
  canUseSplitLayout: boolean,
): "unified" | "split" {
  return canUseSplitLayout ? layout : "unified";
}

function resolveComparisonRefs(input: {
  diffMode: WorkingDiffComparison;
  commitRange?: CommitRange;
  snapshot?: { fromTree: string; toTree: string };
  branchName: string | null;
  baseRefLabel: string | null;
  files: ParsedDiffFile[];
}): DiffComparisonRefs {
  if (input.diffMode === "commit_range" && input.commitRange) {
    return { from: { sha: input.commitRange.fromSha }, to: { sha: input.commitRange.toSha } };
  }
  if (input.snapshot) {
    return { from: { sha: input.snapshot.fromTree }, to: { sha: input.snapshot.toTree } };
  }
  // Branch comparisons pin HEAD's commit as each file's targetRef; the working tree has none.
  const to = {
    name: input.branchName ?? undefined,
    sha: input.files.find((file) => file.targetRef)?.targetRef,
  };
  if (input.diffMode === "uncommitted") return { from: { name: "HEAD" }, to };
  return { from: { name: input.baseRefLabel ?? undefined }, to };
}

function computeSelectedDiffStat(
  files: ParsedDiffFile[],
  isLoading: boolean,
): { additions: number; deletions: number } | null {
  if (isLoading) {
    return null;
  }
  return sumDiffStat(files);
}

function useDiscardChangesAction({
  serverId,
  cwd,
  diffMode,
}: {
  serverId: string;
  cwd: string;
  diffMode: WorkingDiffComparison;
}): ((path: string, oldPath?: string) => void) | undefined {
  const { t } = useTranslation();
  const toast = useToast();
  const discardChanges = useCheckoutGitActionsStore((state) => state.discardChanges);
  // COMPAT(checkoutDiscardChanges): added in v0.3.0, remove gate after 2027-02-08.
  const discardSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutDiscardChanges === true,
  );
  const discardPath = useCallback(
    async (path: string, oldPath?: string) => {
      const confirmed = await confirmDialog({
        title: t("workspace.fileActions.confirmRevert.title"),
        message: t("workspace.fileActions.confirmRevert.message", { name: path }),
        confirmLabel: t("workspace.fileActions.confirmRevert.confirm"),
        cancelLabel: t("workspace.fileActions.confirmRevert.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      try {
        await discardChanges({
          serverId,
          cwd,
          paths: oldPath ? [path, oldPath] : [path],
        });
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : t("workspace.fileActions.confirmRevert.failed"),
        );
      }
    },
    [cwd, discardChanges, serverId, t, toast],
  );
  const handleDiscardPath = useCallback(
    (path: string, oldPath?: string) => {
      void discardPath(path, oldPath);
    },
    [discardPath],
  );
  return discardSupported && diffMode === "uncommitted" ? handleDiscardPath : undefined;
}

interface ChangesSurfaceProps {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  enabled?: boolean;
  presentation?: ChangesPresentation;
  focusPath?: string;
  focusRequestId?: number;
  onOpenFile?: (path: string) => void;
  onOpenToSide?: (path: string) => void;
  onSelectDiffFile?: (path: string) => void;
  onAddToChat?: (path: string) => void;
  onRevealInExplorer?: (path: string) => void;
  state?: ChangesState;
  onStateChange?: (state: ChangesState) => void;
}

type PressableStyleFn = (
  state: PressableStateCallbackType & { hovered?: boolean; open?: boolean },
) => StyleProp<ViewStyle>;

const foregroundMutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedAlignJustify = withUnistyles(AlignJustify);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedPilcrow = withUnistyles(Pilcrow);
const ThemedWrapText = withUnistyles(WrapText);
const ThemedListChevronsDownUp = withUnistyles(ListChevronsDownUp);
const ThemedListChevronsUpDown = withUnistyles(ListChevronsUpDown);
const noopStateChange = () => {};
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const DIFF_OPTIONS_WHITESPACE_ICON = (
  <ThemedPilcrow size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_OPTIONS_WRAP_ICON = (
  <ThemedWrapText size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_OPTIONS_SPLIT_ICON = (
  <ThemedColumns2 size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_OPTIONS_COLLAPSE_ICON = (
  <ThemedListChevronsDownUp size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_OPTIONS_EXPAND_ICON = (
  <ThemedListChevronsUpDown size={14} uniProps={foregroundMutedIconColorMapping} />
);

interface DiffLayoutToggleProps {
  layout: "unified" | "split";
  isMobile: boolean;
  testID?: string;
  toggleStyle?: PressableStyleFn;
  onToggle: () => void;
}
export function DiffLayoutToggle({
  layout,
  isMobile,
  testID = "changes-toggle-layout",
  toggleStyle,
  onToggle,
}: DiffLayoutToggleProps) {
  const defaultToggleStyle = useMemo(
    () => buildToggleButtonStyle(false, undefined, isMobile),
    [isMobile],
  );
  const { t } = useTranslation();
  const label =
    layout === "unified"
      ? t("workspace.git.diff.switchToSplit")
      : t("workspace.git.diff.switchToUnified");
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={testID}
          onPress={onToggle}
          style={toggleStyle ?? defaultToggleStyle}
        >
          {layout === "unified" ? (
            <ThemedColumns2 size={isMobile ? 18 : 14} uniProps={foregroundMutedIconColorMapping} />
          ) : (
            <ThemedAlignJustify
              size={isMobile ? 18 : 14}
              uniProps={foregroundMutedIconColorMapping}
            />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

interface TurnDiffModes {
  selectLastTurn: () => void;
}

interface CommitRangeModes {
  serverId: string;
  cwd: string;
  selected: CommitRange | undefined;
  select: (range: CommitRange) => void;
}

interface DiffModeMenuProps {
  diffMode: WorkingDiffComparison;
  testIDPrefix?: string;
  onSelectUncommitted: () => void;
  onSelectBase: () => void;
  onSelectAll?: () => void;
  turnModes?: TurnDiffModes | null;
  commitRanges?: CommitRangeModes | null;
}

const DIFF_MODE_LABEL_KEYS = {
  uncommitted: "workspace.git.diff.uncommitted",
  base: "workspace.git.diff.committed",
  last_turn: "workspace.git.diff.lastTurn",
  [LiveDiffComparison.All]: "workspace.git.diff.allChanges",
} as const satisfies Record<Exclude<WorkingDiffComparison, CommitRangeComparison>, string>;

function useDiffModeLabel(input: {
  diffMode: WorkingDiffComparison;
  commitRanges?: CommitRangeModes | null;
}): string {
  const { t } = useTranslation();
  const { diffMode, commitRanges } = input;
  const range = diffMode === "commit_range" ? commitRanges?.selected : undefined;
  const { shas } = useWorkspaceCommits({
    serverId: commitRanges?.serverId ?? "",
    cwd: commitRanges?.cwd ?? "",
    enabled: Boolean(range),
  });
  if (diffMode !== "commit_range") return t(DIFF_MODE_LABEL_KEYS[diffMode]);
  if (!range) return t("workspace.git.diff.committed");
  const span = commitRangeSpan(shas, range);
  return formatCommitRange({ t, range, count: span && span.oldest - span.newest + 1 });
}

export function DiffModeMenu({
  diffMode,
  testIDPrefix = "changes-diff",
  onSelectUncommitted,
  onSelectBase,
  onSelectAll,
  turnModes,
  commitRanges,
}: DiffModeMenuProps) {
  const { t } = useTranslation();
  const label = useDiffModeLabel({ diffMode, commitRanges });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID={`${testIDPrefix}-status-trigger`}
        style={toolbarLabelTriggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.git.diff.diffMode")}
      >
        {(state) => {
          const highlighted = isToolbarLabelTriggerHighlighted(state);
          return (
            <>
              <Text style={toolbarLabelTriggerTextStyle(highlighted)} numberOfLines={1}>
                {label}
              </Text>
              <ToolbarLabelTriggerIcon>
                <ThemedChevronDown size={12} uniProps={extraMutedIconColorMapping} />
              </ToolbarLabelTriggerIcon>
            </>
          );
        }}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        width={commitRanges ? 380 : 260}
        testID={`${testIDPrefix}-status-menu`}
      >
        <DropdownMenuItem
          testID={`${testIDPrefix}-mode-uncommitted`}
          selected={diffMode === "uncommitted"}
          onSelect={onSelectUncommitted}
        >
          {t(DIFF_MODE_LABEL_KEYS.uncommitted)}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID={`${testIDPrefix}-mode-committed`}
          selected={diffMode === "base"}
          onSelect={onSelectBase}
        >
          {t(DIFF_MODE_LABEL_KEYS.base)}
        </DropdownMenuItem>
        {onSelectAll ? (
          <DropdownMenuItem
            testID={`${testIDPrefix}-mode-all`}
            selected={diffMode === LiveDiffComparison.All}
            onSelect={onSelectAll}
          >
            {t(DIFF_MODE_LABEL_KEYS[LiveDiffComparison.All])}
          </DropdownMenuItem>
        ) : null}
        {turnModes ? (
          <DropdownMenuItem
            testID={`${testIDPrefix}-mode-last-turn`}
            selected={diffMode === "last_turn"}
            onSelect={turnModes.selectLastTurn}
          >
            {t(DIFF_MODE_LABEL_KEYS.last_turn)}
          </DropdownMenuItem>
        ) : null}
        {commitRanges ? (
          <CommitRangeMenuSection
            serverId={commitRanges.serverId}
            cwd={commitRanges.cwd}
            selected={commitRanges.selected}
            onSave={commitRanges.select}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ChangesPresentation = "combined" | "tree" | "diff";

interface ChangesToolbarRefreshAction {
  isRefreshing: boolean;
  onRefresh: () => void;
}

export interface ChangesToolbarDiffOptions {
  collapse: {
    allFilesCollapsed: boolean;
    onCollapseAll: () => void;
    onExpandAll: () => void;
  } | null;
  layout: {
    value: "unified" | "split";
    onToggle: () => void;
  } | null;
  hideWhitespace: boolean;
  wrapLines: boolean;
  onToggleHideWhitespace: () => void;
  onToggleWrapLines: () => void;
}

type ChangesToolbarMode =
  | {
      kind: "tree";
      refresh: ChangesToolbarRefreshAction | null;
    }
  | {
      kind: "diff";
      options: ChangesToolbarDiffOptions;
      refresh: ChangesToolbarRefreshAction | null;
    }
  | {
      kind: "combined";
      options: ChangesToolbarDiffOptions;
      refresh: ChangesToolbarRefreshAction | null;
      treeToggle: { visible: boolean; onToggle: () => void } | null;
    };

function buildChangesToolbarMode(input: {
  presentation: ChangesPresentation;
  compact: boolean;
  hasChanges: boolean;
  canUseSplitLayout: boolean;
  refreshSupported: boolean;
  isRefreshing: boolean;
  layout: "unified" | "split";
  hideWhitespace: boolean;
  wrapLines: boolean;
  treeVisible: boolean;
  onRefresh: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  allFilesCollapsed: boolean;
  onToggleLayout: () => void;
  onToggleHideWhitespace: () => void;
  onToggleWrapLines: () => void;
  onToggleTree: () => void;
}): ChangesToolbarMode {
  const refresh = input.refreshSupported
    ? { isRefreshing: input.isRefreshing, onRefresh: input.onRefresh }
    : null;
  if (input.presentation === "tree") {
    return {
      kind: "tree",
      refresh,
    };
  }
  const options: ChangesToolbarDiffOptions = {
    collapse: input.hasChanges
      ? {
          allFilesCollapsed: input.allFilesCollapsed,
          onCollapseAll: input.onCollapseAll,
          onExpandAll: input.onExpandAll,
        }
      : null,
    layout: input.canUseSplitLayout
      ? { value: input.layout, onToggle: input.onToggleLayout }
      : null,
    hideWhitespace: input.hideWhitespace,
    wrapLines: input.wrapLines,
    onToggleHideWhitespace: input.onToggleHideWhitespace,
    onToggleWrapLines: input.onToggleWrapLines,
  };
  if (input.presentation === "diff") {
    return { kind: "diff", options, refresh };
  }
  return {
    kind: "combined",
    options,
    refresh,
    treeToggle:
      !input.compact && input.hasChanges
        ? { visible: input.treeVisible, onToggle: input.onToggleTree }
        : null,
  };
}

interface ChangesRepositoryToolbarModel {
  baseRefLabel: string | null;
  branchName: string | null;
  cwd: string;
  gitActions: GitActions | null;
  serverId: string;
  workspaceId?: string | null;
}

interface ChangesComparisonToolbarModel {
  diffMode: WorkingDiffComparison;
  turnModes: TurnDiffModes | null;
  commitRanges: CommitRangeModes | null;
  mode: ChangesToolbarMode;
  selectedDiffStat: { additions: number; deletions: number } | null;
  onSelectBase: () => void;
  onSelectAll?: () => void;
  onSelectUncommitted: () => void;
}

interface ChangesHeaderProps {
  compact: boolean;
  repository: ChangesRepositoryToolbarModel;
  comparison: ChangesComparisonToolbarModel;
  sidebarSurface: boolean;
}

interface BuildChangesHeaderModelInput {
  baseRefLabel: string | null;
  branchName: string | null;
  compact: boolean;
  cwd: string;
  diffMode: WorkingDiffComparison;
  turnModes: TurnDiffModes | null;
  commitRanges: CommitRangeModes | null;
  gitActions: GitActions;
  mode: ChangesToolbarMode;
  onSelectBase: () => void;
  onSelectAll?: () => void;
  onSelectUncommitted: () => void;
  selectedDiffStat: { additions: number; deletions: number } | null;
  serverId: string;
  workspaceId?: string | null;
}

function buildChangesHeaderModel(input: BuildChangesHeaderModelInput): {
  repository: ChangesRepositoryToolbarModel;
  comparison: ChangesComparisonToolbarModel;
} {
  return {
    repository: {
      baseRefLabel: input.baseRefLabel,
      branchName: input.branchName,
      cwd: input.cwd,
      // Commit and push act on the live checkout, not on a turn or commit range snapshot.
      gitActions:
        input.compact && !isSnapshotDiffComparison(input.diffMode) ? input.gitActions : null,
      serverId: input.serverId,
      workspaceId: input.workspaceId,
    },
    comparison: {
      diffMode: input.diffMode,
      turnModes: input.turnModes,
      commitRanges: input.commitRanges,
      mode: input.mode,
      selectedDiffStat: input.selectedDiffStat,
      onSelectBase: input.onSelectBase,
      onSelectAll: input.onSelectAll,
      onSelectUncommitted: input.onSelectUncommitted,
    },
  };
}

// Presentation resolves into these two capability models before rendering. The rows
// never infer which host or Changes presentation produced them.
function ChangesHeader({ compact, repository, comparison, sidebarSurface }: ChangesHeaderProps) {
  if (comparison.mode.kind === "diff") {
    return (
      <ChangesComparisonToolbar
        compact={compact}
        model={comparison}
        sidebarSurface={sidebarSurface}
      />
    );
  }
  return (
    <View>
      <ChangesRepositoryToolbar
        compact={compact}
        model={repository}
        sidebarSurface={sidebarSurface}
      />
      <ChangesComparisonToolbar
        compact={compact}
        model={comparison}
        sidebarSurface={sidebarSurface}
      />
    </View>
  );
}

function ChangesToolbarRow({
  children,
  compact,
  sidebarSurface,
  testID,
  trailing,
}: {
  children: ReactNode;
  compact: boolean;
  sidebarSurface: boolean;
  testID: string;
  /** What the row's last control paints, so it can pad to the shared trailing rail. */
  trailing: ToolbarTrailingControl;
}) {
  const toolbarStyle = useMemo(
    () => [
      styles.changesToolbar,
      { paddingRight: paneContentToolbarTrailingPadding(compact, trailing) },
      sidebarSurface ? styles.changesToolbarSidebar : null,
    ],
    [compact, sidebarSurface, trailing],
  );
  return (
    <PaneContentToolbar style={toolbarStyle} testID={testID}>
      {children}
    </PaneContentToolbar>
  );
}

function ChangesToolbarLeading({ children }: { children?: ReactNode }) {
  return <View style={styles.changesToolbarIdentity}>{children}</View>;
}

function ChangesToolbarTrailing({ children }: { children: ReactNode }) {
  return <ToolbarControls style={styles.changesToolbarControls}>{children}</ToolbarControls>;
}

function ChangesRepositoryToolbar({
  compact,
  model,
  sidebarSurface,
}: {
  compact: boolean;
  model: ChangesRepositoryToolbarModel;
  sidebarSurface: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ChangesToolbarRow
      compact={compact}
      sidebarSurface={sidebarSurface}
      testID="changes-repository-header"
      trailing={model.gitActions ? "framed" : "glyph"}
    >
      <ChangesToolbarLeading>
        <View style={toolbarLabelTriggerFrameStyle()}>
          <Text
            testID="changes-current-branch"
            style={toolbarLabelTriggerTextStyle(false)}
            numberOfLines={1}
          >
            {model.branchName ?? t("branchSwitcher.detachedHead")}
          </Text>
        </View>
        {model.baseRefLabel ? (
          <BaseRefSwitcher
            baseRefLabel={model.baseRefLabel}
            serverId={model.serverId}
            workspaceId={model.workspaceId ?? model.cwd}
            cwd={model.cwd}
          />
        ) : null}
      </ChangesToolbarLeading>
      <ChangesToolbarTrailing>
        {model.gitActions ? <GitActionsSplitButton gitActions={model.gitActions} menuOnly /> : null}
      </ChangesToolbarTrailing>
    </ChangesToolbarRow>
  );
}

function ChangesComparisonToolbar({
  compact,
  model,
  sidebarSurface,
}: {
  compact: boolean;
  model: ChangesComparisonToolbarModel;
  sidebarSurface: boolean;
}) {
  return (
    <ChangesToolbarRow
      compact={compact}
      sidebarSurface={sidebarSurface}
      testID="changes-header"
      trailing="glyph"
    >
      <ChangesToolbarLeading>
        <DiffModeMenu
          diffMode={model.diffMode}
          onSelectUncommitted={model.onSelectUncommitted}
          onSelectBase={model.onSelectBase}
          onSelectAll={model.onSelectAll}
          turnModes={model.turnModes}
          commitRanges={model.commitRanges}
        />
        {model.selectedDiffStat ? (
          <DiffStat
            additions={model.selectedDiffStat.additions}
            deletions={model.selectedDiffStat.deletions}
            testID="changes-selected-diff-stat"
          />
        ) : null}
      </ChangesToolbarLeading>
      <ChangesToolbarTrailing>
        <ChangesToolbarActions mode={model.mode} compact={compact} />
      </ChangesToolbarTrailing>
    </ChangesToolbarRow>
  );
}

function ChangesToolbarActions({ mode, compact }: { mode: ChangesToolbarMode; compact: boolean }) {
  if (mode.kind === "tree") {
    return mode.refresh ? <ChangesRefreshButton refresh={mode.refresh} compact={compact} /> : null;
  }
  if (mode.kind === "diff") {
    return (
      <>
        <ChangesDiffToolbar options={mode.options} compact={compact} />
        {mode.refresh ? <ChangesRefreshButton refresh={mode.refresh} compact={compact} /> : null}
      </>
    );
  }
  return (
    <>
      {mode.treeToggle ? (
        <TreeRailToggle
          visible={mode.treeToggle.visible}
          testID="changes-toggle-tree"
          onToggle={mode.treeToggle.onToggle}
        />
      ) : null}
      <ChangesOptionsMenu options={mode.options} compact={compact} />
      {mode.refresh ? <ChangesRefreshButton refresh={mode.refresh} compact={compact} /> : null}
    </>
  );
}

export function ChangesDiffToolbar({
  options,
  compact,
}: {
  options: ChangesToolbarDiffOptions;
  compact: boolean;
}) {
  const { t } = useTranslation();
  const iconSize = paneContentToolbarIconSize(compact);
  const collapseLabel = t(
    options.collapse?.allFilesCollapsed
      ? "workspace.git.diff.expandAllFiles"
      : "workspace.git.diff.collapseAllFiles",
  );
  const whitespaceLabel = options.hideWhitespace
    ? t("workspace.git.diff.showWhitespace")
    : t("workspace.git.diff.hideWhitespace");
  const wrapLinesLabel = options.wrapLines
    ? t("workspace.git.diff.scrollLongLines")
    : t("workspace.git.diff.wrapLongLines");
  const layoutLabel =
    options.layout?.value === "split"
      ? t("workspace.git.diff.switchToUnified")
      : t("workspace.git.diff.switchToSplit");
  return (
    <>
      {options.collapse ? (
        <ToolbarButton
          compact={compact}
          label={collapseLabel}
          testID="changes-toggle-collapse-all"
          onPress={
            options.collapse.allFilesCollapsed
              ? options.collapse.onExpandAll
              : options.collapse.onCollapseAll
          }
        >
          {options.collapse.allFilesCollapsed ? (
            <ThemedListChevronsUpDown size={iconSize} uniProps={extraMutedIconColorMapping} />
          ) : (
            <ThemedListChevronsDownUp size={iconSize} uniProps={extraMutedIconColorMapping} />
          )}
        </ToolbarButton>
      ) : null}
      {options.layout ? (
        <ToolbarButton
          compact={compact}
          label={layoutLabel}
          selected={options.layout.value === "split"}
          testID="changes-toggle-layout"
          onPress={options.layout.onToggle}
        >
          <ThemedColumns2 size={iconSize} uniProps={extraMutedIconColorMapping} />
        </ToolbarButton>
      ) : null}
      <ToolbarButton
        compact={compact}
        label={whitespaceLabel}
        selected={options.hideWhitespace}
        testID="changes-toggle-whitespace"
        onPress={options.onToggleHideWhitespace}
      >
        <ThemedPilcrow size={iconSize} uniProps={extraMutedIconColorMapping} />
      </ToolbarButton>
      <ToolbarButton
        compact={compact}
        label={wrapLinesLabel}
        selected={options.wrapLines}
        testID="changes-toggle-wrap-lines"
        onPress={options.onToggleWrapLines}
      >
        <ThemedWrapText size={iconSize} uniProps={extraMutedIconColorMapping} />
      </ToolbarButton>
    </>
  );
}

function ChangesRefreshButton({
  refresh,
  compact,
}: {
  refresh: ChangesToolbarRefreshAction;
  compact: boolean;
}) {
  const { t } = useTranslation();
  const refreshLabel = refresh.isRefreshing
    ? t("workspace.git.diff.refreshing")
    : t("workspace.git.diff.refresh");
  return (
    <ToolbarButton
      label={refreshLabel}
      compact={compact}
      disabled={refresh.isRefreshing}
      testID="changes-refresh"
      onPress={refresh.onRefresh}
    >
      {refresh.isRefreshing ? (
        <ThemedLoadingSpinner
          size={paneContentToolbarIconSize(compact)}
          uniProps={extraMutedIconColorMapping}
        />
      ) : (
        <ThemedRotateCw
          size={paneContentToolbarIconSize(compact)}
          uniProps={extraMutedIconColorMapping}
        />
      )}
    </ToolbarButton>
  );
}

function ChangesOptionsMenu({
  options,
  compact,
}: {
  options: ChangesToolbarDiffOptions;
  compact: boolean;
}) {
  const { t } = useTranslation();
  const optionsLabel = t("workspace.git.diff.options");
  return (
    <DropdownMenu>
      <ToolbarButton
        kind="menu"
        label={optionsLabel}
        compact={compact}
        testID="changes-options-menu"
      >
        <ThemedMoreHorizontal
          size={paneContentToolbarIconSize(compact)}
          uniProps={extraMutedIconColorMapping}
        />
      </ToolbarButton>
      <DropdownMenuContent align="end" width={240} testID="changes-options-menu-content">
        <ChangesDiffOptions options={options} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChangesDiffOptions({ options }: { options: ChangesToolbarDiffOptions }) {
  const { t } = useTranslation();
  const collapseLabel = t(
    options.collapse?.allFilesCollapsed
      ? "workspace.git.diff.expandAllFiles"
      : "workspace.git.diff.collapseAllFiles",
  );
  const whitespaceLabel = options.hideWhitespace
    ? t("workspace.git.diff.showWhitespace")
    : t("workspace.git.diff.hideWhitespace");
  const wrapLinesLabel = options.wrapLines
    ? t("workspace.git.diff.scrollLongLines")
    : t("workspace.git.diff.wrapLongLines");

  return (
    <>
      {options.collapse ? (
        <>
          <DropdownMenuItem
            leading={
              options.collapse.allFilesCollapsed
                ? DIFF_OPTIONS_EXPAND_ICON
                : DIFF_OPTIONS_COLLAPSE_ICON
            }
            testID="changes-toggle-collapse-all"
            onSelect={
              options.collapse.allFilesCollapsed
                ? options.collapse.onExpandAll
                : options.collapse.onCollapseAll
            }
          >
            {collapseLabel}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      ) : null}
      {options.layout ? (
        <DropdownMenuItem
          leading={DIFF_OPTIONS_SPLIT_ICON}
          selected={options.layout.value === "split"}
          testID="changes-toggle-layout"
          onSelect={options.layout.onToggle}
        >
          {t("workspace.git.diff.split")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        leading={DIFF_OPTIONS_WHITESPACE_ICON}
        selected={options.hideWhitespace}
        testID="changes-toggle-whitespace"
        onSelect={options.onToggleHideWhitespace}
      >
        {whitespaceLabel}
      </DropdownMenuItem>
      <DropdownMenuItem
        leading={DIFF_OPTIONS_WRAP_ICON}
        selected={options.wrapLines}
        testID="changes-toggle-wrap-lines"
        onSelect={options.onToggleWrapLines}
      >
        {wrapLinesLabel}
      </DropdownMenuItem>
    </>
  );
}

const ThemedRotateCw = withUnistyles(RotateCw);

interface DiffBodyContentProps {
  isStatusLoading: boolean;
  statusErrorMessage: string | null;
  notGit: boolean;
  isDiffLoading: boolean;
  diffErrorMessage: string | null;
  diffTooLarge: boolean;
  hasChanges: boolean;
  emptyMessage: string;
  emptyAction: ChangesEmptyAction | null;
  children: ReactElement;
  historyStatus?: CheckoutDiffHistoryStatus;
  historyLoadingLabel: string;
  historyRetryLabel: string;
  onRetryHistory?: () => void;
  checkingRepositoryLabel: string;
  notRepositoryLabel: string;
}

function DiffBodyContent({
  isStatusLoading,
  statusErrorMessage,
  notGit,
  isDiffLoading,
  diffErrorMessage,
  diffTooLarge,
  hasChanges,
  emptyMessage,
  emptyAction,
  children,
  historyStatus,
  historyLoadingLabel,
  historyRetryLabel,
  onRetryHistory,
  checkingRepositoryLabel,
  notRepositoryLabel,
}: DiffBodyContentProps) {
  if (isStatusLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ThemedLoadingSpinner size="large" uniProps={foregroundMutedIconColorMapping} />
        <Text style={styles.loadingText}>{checkingRepositoryLabel}</Text>
      </View>
    );
  }
  if (statusErrorMessage) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{statusErrorMessage}</Text>
      </View>
    );
  }
  if (notGit) {
    return (
      <View style={styles.emptyContainer} testID="changes-not-git">
        <Text style={styles.emptyText}>{notRepositoryLabel}</Text>
      </View>
    );
  }
  if (isDiffLoading) {
    return (
      <View style={styles.loadingContainer} testID="changes-loading">
        <ThemedLoadingSpinner size="large" uniProps={foregroundMutedIconColorMapping} />
        {historyStatus === CheckoutDiffHistoryStatus.Fetching ? (
          <Text style={styles.loadingText}>{historyLoadingLabel}</Text>
        ) : null}
      </View>
    );
  }
  if (diffTooLarge) {
    return <DiffTooLargeState />;
  }
  if (diffErrorMessage) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{diffErrorMessage}</Text>
        {onRetryHistory ? (
          <Button
            variant="ghost"
            size="xs"
            testID="changes-deepen-history"
            onPress={onRetryHistory}
          >
            {historyRetryLabel}
          </Button>
        ) : null}
      </View>
    );
  }
  if (!hasChanges) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{emptyMessage}</Text>
        {emptyAction ? (
          <Button
            variant="ghost"
            size="xs"
            testID="changes-empty-switch-mode"
            onPress={emptyAction.onPress}
          >
            {emptyAction.label}
          </Button>
        ) : null}
      </View>
    );
  }
  return children;
}

// COMPAT(checkoutSetBaseRef): daemons before v0.11.0 send no baseRefLabel.
function selectBaseRefLabel(status: CheckoutStatusPayload | null): string | null {
  return status?.baseRefLabel ?? status?.baseRef ?? null;
}

interface ChangesEmptyAction {
  label: string;
  onPress: () => void;
}

function resolveChangesEmptyMessage(input: {
  diffMode: WorkingDiffComparison;
  isTurnSnapshotMissing: boolean;
  t: TFunction;
}): string {
  if (input.isTurnSnapshotMissing) return input.t("workspace.git.diff.noTurnSnapshot");
  if (input.diffMode === "last_turn") return input.t("workspace.git.diff.noLastTurnChanges");
  return input.t("diffViewer.empty");
}

function computeChangesEmptyAction(input: {
  hideWhitespace: boolean;
  diffMode: WorkingDiffComparison;
  status: CheckoutStatusPayload | null;
  seeUncommittedLabel: string;
  seeCommittedLabel: string;
  selectUncommitted: () => void;
  selectBase: () => void;
}): ChangesEmptyAction | null {
  if (input.hideWhitespace || !input.status?.isGit) {
    return null;
  }
  if (input.diffMode === "base" && input.status.isDirty) {
    return { label: input.seeUncommittedLabel, onPress: input.selectUncommitted };
  }
  if (input.diffMode === "uncommitted" && (input.status.aheadBehind?.ahead ?? 0) > 0) {
    return { label: input.seeCommittedLabel, onPress: input.selectBase };
  }
  return null;
}

function computePrErrorMessage(
  githubFeaturesEnabled: boolean,
  prPayloadError: { message?: string } | null | undefined,
): string | null {
  if (!githubFeaturesEnabled) return null;
  return prPayloadError?.message ?? null;
}

// The precise setup step a workspace needs before its forge features work, or
// null when nothing is actionable (authenticated, or no forge remote at all).
type ForgeSetupAction = "install_cli" | "sign_in" | null;

// Drive the onboarding callout from the forge's auth state so the message names
// the exact next step (install the CLI vs sign in) for whichever forge backs the
// workspace — GitHub included. GitLab additionally requires the host to advertise
// GitLab support, matching the rest of the GitLab UI.
function computeForgeSetupAction(input: {
  forge: Forge;
  forgeProvidersSupported: boolean;
  authState: ForgeAuthState | undefined;
}): ForgeSetupAction {
  // A daemon without pluggable forge support can't operate any non-GitHub forge,
  // so don't offer a setup action for one it can't drive.
  if (input.forge !== "github" && !input.forgeProvidersSupported) {
    return null;
  }
  switch (input.authState) {
    case "cli_missing":
      return "install_cli";
    case "unauthenticated":
      return "sign_in";
    case "authenticated":
    case "no_remote":
    case "error":
      return null;
    default:
      return null;
  }
}

function parseForgeHost(url: string | null | undefined): string | null {
  return url ? (parseGitRemoteLocation(url)?.host ?? null) : null;
}

function buildForgeSetupMessage(input: {
  action: ForgeSetupAction;
  forge: Forge;
  host: string | null;
  t: TFunction;
}): string | null {
  if (!input.action) {
    return null;
  }
  const { brandLabel, signInCli } = getForgePresentation(input.forge);
  // A forge with no known CLI (an unknown/third-party forge rendered neutrally)
  // has no install/sign-in command to interpolate — show neutral guidance
  // rather than the GitLab-specific callout or a null command.
  if (signInCli === null) {
    return input.t("workspace.git.forgeSetup.generic", { brand: brandLabel });
  }
  if (input.action === "install_cli") {
    return input.t("workspace.git.forgeSetup.installCli", { cli: signInCli, brand: brandLabel });
  }
  const command = buildForgeSignInCommand(input.forge, input.host);
  return input.t("workspace.git.forgeSetup.signIn", { command, brand: brandLabel });
}

function buildToggleButtonStyle(
  selected: boolean,
  baseStyles?: StyleProp<ViewStyle> | StyleProp<ViewStyle>[],
  isMobile = false,
): PressableStyleFn {
  return (state) => [baseStyles, paneContentToolbarIconButtonStyle(state, selected, isMobile)];
}

interface JumpToFileVisibility {
  isCompact: boolean;
  presentation: ChangesPresentation;
  hasChanges: boolean;
  isDiffLoading: boolean;
}

/**
 * The room the floating Jump to file action needs over the diff, and zero where
 * it is not offered. Compact users never see the tree rail, so the diff is their
 * only view of what changed; the tree and diff presentations are already halves
 * of a desktop split.
 */
function jumpToFileClearance(visibility: JumpToFileVisibility): number {
  if (!visibility.isCompact || visibility.presentation !== "combined") return 0;
  if (!visibility.hasChanges || visibility.isDiffLoading) return 0;
  return JUMP_TO_FILE_CLEARANCE;
}

function ChangesTreeRail({
  shown,
  children,
  files,
  mode,
  onSelectFile,
  treeWidth,
  onTreeWidthChange,
  collapsedFolderPaths,
  onCollapsedFolderPathsChange,
}: {
  shown: boolean;
  children: ReactElement;
  files: ParsedDiffFile[];
  mode: WorkingDiffMode;
  onSelectFile: (path: string) => void;
  treeWidth?: number;
  onTreeWidthChange: (width: number) => void;
  collapsedFolderPaths: string[];
  onCollapsedFolderPathsChange: (paths: string[]) => void;
}) {
  if (!shown) return children;
  return (
    <TreeRail testID="changes-tree-rail" width={treeWidth ?? 220} onWidthChange={onTreeWidthChange}>
      {children}
      <ChangedFilesTree
        files={files}
        mode={mode}
        onSelectFile={onSelectFile}
        collapsedFolderPaths={collapsedFolderPaths}
        onCollapsedFolderPathsChange={onCollapsedFolderPathsChange}
      />
    </TreeRail>
  );
}

function ChangesBody({
  isLoading,
  errorMessage,
  presentation,
  children,
  desktopTreeVisible,
  isMobile,
  files,
  mode,
  onSelectFile,
  treeWidth,
  onTreeWidthChange,
  collapsedFolderPaths,
  onCollapsedFolderPathsChange,
}: {
  isLoading: boolean;
  errorMessage: string | null;
  presentation: ChangesPresentation;
  children: ReactElement;
  desktopTreeVisible: boolean;
  isMobile: boolean;
  files: ParsedDiffFile[];
  mode: WorkingDiffMode;
  onSelectFile: (path: string) => void;
  treeWidth?: number;
  onTreeWidthChange: (width: number) => void;
  collapsedFolderPaths: string[];
  onCollapsedFolderPathsChange: (paths: string[]) => void;
}) {
  if (isLoading || errorMessage) return children;
  if (presentation === "tree") {
    if (files.length === 0) return children;
    return (
      <ChangedFilesTree
        files={files}
        mode={mode}
        onSelectFile={onSelectFile}
        collapsedFolderPaths={collapsedFolderPaths}
        onCollapsedFolderPathsChange={onCollapsedFolderPathsChange}
      />
    );
  }
  if (presentation === "diff") return children;
  return (
    <ChangesTreeRail
      shown={desktopTreeVisible && !isMobile && files.length > 0}
      files={files}
      mode={mode}
      onSelectFile={onSelectFile}
      treeWidth={treeWidth}
      onTreeWidthChange={onTreeWidthChange}
      collapsedFolderPaths={collapsedFolderPaths}
      onCollapsedFolderPathsChange={onCollapsedFolderPathsChange}
    >
      {children}
    </ChangesTreeRail>
  );
}

export function ChangesSurface({
  serverId,
  workspaceId,
  cwd,
  enabled,
  presentation = "combined",
  focusPath,
  focusRequestId,
  onOpenFile,
  onOpenToSide,
  onSelectDiffFile,
  onAddToChat,
  onRevealInExplorer,
  state: changesState,
  onStateChange,
}: ChangesSurfaceProps) {
  const { settings: appSettings } = useAppSettings();
  const { preferences, updatePreferences } = useChangesPreferences();
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const canUseSplitLayout = isWeb && !isMobile;
  const instanceState = changesState ?? defaultChangesState;
  const updateState = onStateChange ?? noopStateChange;
  const wrapLines = preferences.wrapLines;
  const desktopTreeVisible = instanceState.treeVisible;
  const effectiveLayout = resolveDiffLayout(preferences.layout, canUseSplitLayout);
  const collapsedFilePaths = instanceState.collapsedFilePaths;
  const updateCollapsedFilePaths = useCallback(
    (paths: string[]) => updateState({ ...instanceState, collapsedFilePaths: paths }),
    [instanceState, updateState],
  );
  const updateCollapsedFolderPaths = useCallback(
    (paths: string[]) => updateState({ ...instanceState, collapsedFolderPaths: paths }),
    [instanceState, updateState],
  );
  const collapseState = useMemo(
    () => ({ paths: collapsedFilePaths, onChange: updateCollapsedFilePaths }),
    [collapsedFilePaths, updateCollapsedFilePaths],
  );

  const handleToggleWrapLines = useCallback(() => {
    void updatePreferences({ wrapLines: !wrapLines });
  }, [updatePreferences, wrapLines]);

  const handleToggleHideWhitespace = useCallback(() => {
    void updatePreferences({ hideWhitespace: !preferences.hideWhitespace });
  }, [preferences.hideWhitespace, updatePreferences]);

  const handleToggleLayout = useCallback(() => {
    const layout = preferences.layout === "unified" ? "split" : "unified";
    void updatePreferences({ layout });
  }, [preferences.layout, updatePreferences]);
  const codeFontSize = appSettings.codeFontSize;

  const toast = useToast();
  const revealFileInFileManager = useRevealInFileManager({ serverId, workspaceRoot: cwd });
  const refreshSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutRefresh === true,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client);
  // COMPAT(fsEntryDuplicate): added in v0.3.0, remove gate after 2027-02-09.
  const fsEntryDuplicateEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.fsEntryDuplicate === true,
  );
  const runRefresh = useCheckoutGitActionsStore((s) => s.refresh);
  const isRefreshing =
    useCheckoutGitActionsStore((s) => s.getStatus({ serverId, cwd, actionId: "refresh" })) ===
    "pending";

  const handleRefresh = useCallback(() => {
    if (isRefreshing) {
      return;
    }
    void runRefresh({ serverId, cwd }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("workspace.git.diff.failedRefresh"));
    });
  }, [cwd, isRefreshing, runRefresh, serverId, t, toast]);

  const {
    status,
    isStatusLoading,
    isGit,
    notGit,
    statusErrorMessage,
    currentBranchName,
    diffMode,
    selectUncommitted: handleSelectUncommitted,
    selectBase: handleSelectBase,
    selectAll: handleSelectAll,
    turnModes,
    commitRange,
    selectCommitRange,
    isTurnSnapshotMissing,
    files,
    diffPayloadError,
    diffTooLarge,
    isDiffLoading,
    historyStatus,
    retryHistory,
    reviewActions,
    commentsCapabilityMissing,
    onExpandGap,
    deferredFileLoads,
    onLoadDeferredFile,
    snapshot,
  } = useWorkingDiff({
    serverId,
    workspaceId: workspaceId ?? undefined,
    cwd,
    ignoreWhitespace: preferences.hideWhitespace,
    enabled: enabled !== false,
  });
  const {
    githubFeaturesEnabled,
    forge,
    authState,
    payloadError: prPayloadError,
  } = useCheckoutPrStatusQuery({
    serverId,
    cwd,
    enabled: isGit,
  });
  const forgeProvidersSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.forgeProviders === true,
  );
  const forgeSetupAction = computeForgeSetupAction({
    forge,
    forgeProvidersSupported,
    authState,
  });
  const forgeSetupMessage = useMemo(
    () =>
      buildForgeSetupMessage({
        action: forgeSetupAction,
        forge,
        host: parseForgeHost(status?.remoteUrl),
        t,
      }),
    [forgeSetupAction, forge, status?.remoteUrl, t],
  );
  const handleToggleDesktopTree = useCallback(() => {
    updateState({ ...instanceState, treeVisible: !desktopTreeVisible });
  }, [desktopTreeVisible, instanceState, updateState]);
  const handleChangesTreeWidth = useCallback(
    (treeWidth: number) => updateState({ ...instanceState, treeWidth }),
    [instanceState, updateState],
  );
  const sharedDisplayPreferences = useMemo(
    () => ({
      layout: effectiveLayout,
      wrapLines,
      codeFontSize,
      monoFontFamily: appSettings.monoFontFamily,
    }),
    [appSettings.monoFontFamily, codeFontSize, effectiveLayout, wrapLines],
  );
  const downloadFile = useFileDownload({ serverId, workspaceId, workspaceRoot: cwd });
  const handleCopyPath = useCallback(
    (path: string) => {
      void Clipboard.setStringAsync(
        buildAbsoluteExplorerPath({ workspaceRoot: cwd, entryPath: path }),
      );
    },
    [cwd],
  );
  const handleCopyRelativePath = useCallback((path: string) => {
    void Clipboard.setStringAsync(path);
  }, []);
  const handleDownloadPath = useCallback(
    (path: string) => {
      downloadFile({ fileName: path.split("/").pop() ?? path, path });
    },
    [downloadFile],
  );
  const handleDuplicatePath = useCallback(
    async (path: string) => {
      if (!client) {
        return;
      }
      try {
        const payload = await client.duplicateFileEntry({ cwd, path });
        if (!payload.success) {
          toast.error(payload.error ?? t("workspace.fileExplorer.errors.duplicateFailed"));
        }
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [client, cwd, t, toast],
  );
  const onRevertPath = useDiscardChangesAction({ serverId, cwd, diffMode });
  const [localFocusRequest, setLocalFocusRequest] = useState<{
    path: string;
    revision: number;
  } | null>(null);
  const externalFocusRequest = useMemo(
    () => (focusPath ? { path: focusPath, revision: focusRequestId ?? 0 } : null),
    [focusPath, focusRequestId],
  );
  const documentFocusRequest =
    localFocusRequest &&
    (!externalFocusRequest || localFocusRequest.revision >= externalFocusRequest.revision)
      ? localFocusRequest
      : externalFocusRequest;
  const handleSelectTreeFile = useCallback(
    (path: string) => {
      if (presentation === "tree" && onSelectDiffFile) {
        onSelectDiffFile(path);
        return;
      }
      setLocalFocusRequest((current) => ({
        path,
        revision: Math.max(Date.now(), (current?.revision ?? 0) + 1),
      }));
    },
    [onSelectDiffFile, presentation],
  );
  const workingMode = useMemo(
    () => ({
      kind: "working" as const,
      reviewActions,
      focusPath: documentFocusRequest?.path,
      focusRequestId: documentFocusRequest?.revision,
      workspaceFileDragScope: workspaceId ? { serverId, workspaceId } : undefined,
      onOpenFile,
      onOpenToSide,
      onAddToChat,
      onCopyPath: handleCopyPath,
      onCopyRelativePath: handleCopyRelativePath,
      onReveal: revealFileInFileManager,
      onRevealInExplorer,
      onDownload: handleDownloadPath,
      onDuplicate: fsEntryDuplicateEnabled ? handleDuplicatePath : undefined,
      onRevert: onRevertPath,
    }),
    [
      reviewActions,
      documentFocusRequest?.path,
      documentFocusRequest?.revision,
      serverId,
      workspaceId,
      onOpenFile,
      onOpenToSide,
      onAddToChat,
      onRevealInExplorer,
      handleCopyPath,
      handleCopyRelativePath,
      handleDownloadPath,
      handleDuplicatePath,
      revealFileInFileManager,
      fsEntryDuplicateEnabled,
      onRevertPath,
    ],
  );

  const hasChanges = files.length > 0;
  const jumpToFileInset = jumpToFileClearance({
    isCompact: isMobile,
    presentation,
    hasChanges,
    isDiffLoading,
  });
  const showJumpToFile = jumpToFileInset > 0;
  const selectedDiffStat = useMemo(
    () => computeSelectedDiffStat(files, isDiffLoading),
    [files, isDiffLoading],
  );
  const allFilesCollapsed =
    hasChanges && files.every((file) => collapsedFilePaths.includes(file.path));
  const handleCollapseAllFiles = useCallback(
    () => updateCollapsedFilePaths(files.map((file) => file.path)),
    [files, updateCollapsedFilePaths],
  );
  const handleExpandAllFiles = useCallback(
    () => updateCollapsedFilePaths([]),
    [updateCollapsedFilePaths],
  );
  const diffErrorMessage = diffPayloadError?.message ?? null;
  const prErrorMessage = computePrErrorMessage(githubFeaturesEnabled, prPayloadError);
  const baseRefLabel = selectBaseRefLabel(status);
  // The large diff notice returns when the comparison changes, not when its files change.
  const comparisonKey = useMemo(
    () => JSON.stringify([diffMode, baseRefLabel, commitRange, snapshot?.fromTree]),
    [baseRefLabel, commitRange, diffMode, snapshot],
  );
  const comparisonRefs = useMemo(
    () =>
      resolveComparisonRefs({
        diffMode,
        commitRange,
        snapshot,
        branchName: currentBranchName,
        baseRefLabel,
        files,
      }),
    [baseRefLabel, commitRange, currentBranchName, diffMode, files, snapshot],
  );
  const { gitActions } = useGitActions({
    serverId,
    cwd,
    icons: GIT_ACTION_ICONS,
  });
  const emptyMessage = resolveChangesEmptyMessage({ diffMode, isTurnSnapshotMissing, t });
  const emptyAction = computeChangesEmptyAction({
    hideWhitespace: preferences.hideWhitespace,
    diffMode,
    status,
    seeUncommittedLabel: t("workspace.git.diff.seeUncommittedChanges"),
    seeCommittedLabel: t("workspace.git.diff.seeCommittedChanges"),
    selectUncommitted: handleSelectUncommitted,
    selectBase: handleSelectBase,
  });

  const diffContent: ReactElement = (
    <DiffBodyContent
      isStatusLoading={isStatusLoading}
      statusErrorMessage={statusErrorMessage}
      notGit={notGit}
      isDiffLoading={isDiffLoading}
      historyStatus={historyStatus}
      historyLoadingLabel={t("workspace.git.diff.fetchingHistory")}
      historyRetryLabel={t("workspace.git.diff.fetchMoreHistory")}
      onRetryHistory={retryHistory}
      diffErrorMessage={diffErrorMessage}
      diffTooLarge={diffTooLarge}
      hasChanges={hasChanges}
      emptyMessage={emptyMessage}
      emptyAction={emptyAction}
      checkingRepositoryLabel={t("workspace.git.diff.checkingRepository")}
      notRepositoryLabel={t("workspace.git.diff.notRepository")}
    >
      <LargeDiffGate
        files={files}
        comparisonKey={comparisonKey}
        refs={comparisonRefs}
        onShowDiff={handleCollapseAllFiles}
      >
        <DiffDocument
          files={files}
          contentInsetBottom={jumpToFileInset}
          collapseState={collapseState}
          displayPreferences={sharedDisplayPreferences}
          mode={workingMode}
          onExpandGap={onExpandGap}
          deferredFileLoads={deferredFileLoads}
          onLoadDeferredFile={onLoadDeferredFile}
        />
      </LargeDiffGate>
    </DiffBodyContent>
  );
  const bodyContent = (
    <ChangesBody
      isLoading={isDiffLoading}
      errorMessage={diffErrorMessage}
      presentation={presentation}
      desktopTreeVisible={desktopTreeVisible}
      isMobile={isMobile}
      files={files}
      mode={workingMode}
      onSelectFile={handleSelectTreeFile}
      treeWidth={instanceState.treeWidth}
      onTreeWidthChange={handleChangesTreeWidth}
      collapsedFolderPaths={instanceState.collapsedFolderPaths}
      onCollapsedFolderPathsChange={updateCollapsedFolderPaths}
    >
      {diffContent}
    </ChangesBody>
  );
  const toolbarMode = useMemo(
    () =>
      buildChangesToolbarMode({
        presentation,
        compact: isMobile,
        hasChanges,
        canUseSplitLayout,
        refreshSupported,
        isRefreshing,
        layout: preferences.layout,
        hideWhitespace: preferences.hideWhitespace,
        wrapLines,
        treeVisible: desktopTreeVisible,
        onRefresh: handleRefresh,
        onCollapseAll: handleCollapseAllFiles,
        onExpandAll: handleExpandAllFiles,
        allFilesCollapsed,
        onToggleLayout: handleToggleLayout,
        onToggleHideWhitespace: handleToggleHideWhitespace,
        onToggleWrapLines: handleToggleWrapLines,
        onToggleTree: handleToggleDesktopTree,
      }),
    [
      allFilesCollapsed,
      canUseSplitLayout,
      desktopTreeVisible,
      handleCollapseAllFiles,
      handleExpandAllFiles,
      handleRefresh,
      handleToggleDesktopTree,
      handleToggleHideWhitespace,
      handleToggleLayout,
      handleToggleWrapLines,
      hasChanges,
      preferences.hideWhitespace,
      preferences.layout,
      isMobile,
      isRefreshing,
      presentation,
      refreshSupported,
      wrapLines,
    ],
  );
  const commitRanges = useMemo(
    () =>
      selectCommitRange
        ? { serverId, cwd, selected: commitRange, select: selectCommitRange }
        : null,
    [commitRange, cwd, selectCommitRange, serverId],
  );
  const changesHeaderModel = useMemo(
    () =>
      buildChangesHeaderModel({
        baseRefLabel,
        branchName: currentBranchName,
        compact: isMobile,
        cwd,
        diffMode,
        turnModes,
        commitRanges,
        gitActions,
        mode: toolbarMode,
        onSelectBase: handleSelectBase,
        onSelectAll: handleSelectAll,
        onSelectUncommitted: handleSelectUncommitted,
        selectedDiffStat,
        serverId,
        workspaceId,
      }),
    [
      baseRefLabel,
      currentBranchName,
      cwd,
      diffMode,
      turnModes,
      commitRanges,
      gitActions,
      handleSelectBase,
      handleSelectAll,
      handleSelectUncommitted,
      isMobile,
      selectedDiffStat,
      serverId,
      toolbarMode,
      workspaceId,
    ],
  );

  return (
    <View
      {...{
        onContextMenu: (event: { preventDefault?: () => void }) => event.preventDefault?.(),
      }}
      style={styles.container}
    >
      {isGit ? (
        <ChangesHeader
          compact={isMobile}
          repository={changesHeaderModel.repository}
          comparison={changesHeaderModel.comparison}
          sidebarSurface={presentation === "tree"}
        />
      ) : null}

      {forgeSetupMessage ? (
        <View style={styles.forgeSetupCallout} testID="forge-setup-callout">
          <Text style={styles.forgeSetupCalloutText}>{forgeSetupMessage}</Text>
        </View>
      ) : null}

      {prErrorMessage ? <Text style={styles.actionErrorText}>{prErrorMessage}</Text> : null}
      {commentsCapabilityMissing ? (
        <View style={styles.forgeSetupCallout} testID="last-turn-comments-capability-missing">
          <Text style={styles.forgeSetupCalloutText}>
            {t("panels.diff.commentsCapabilityMissing")}
          </Text>
        </View>
      ) : null}

      <View style={styles.diffContainer}>
        {bodyContent}
        {showJumpToFile ? (
          <JumpToFile files={files} mode={workingMode} onSelectFile={handleSelectTreeFile} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  changesToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
  },
  changesToolbarSidebar: {
    backgroundColor: theme.colors.surfaceSidebar,
  },
  changesToolbarIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  changesToolbarControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexShrink: 0,
  },
  diffStatusIconHidden: {
    opacity: 0,
  },
  actionErrorText: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  forgeSetupCallout: {
    marginHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  forgeSetupCalloutText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  diffContainer: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  scrollContainer: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
    gap: theme.spacing[4],
  },
  loadingText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
    paddingHorizontal: theme.spacing[6],
  },
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.destructive,
    textAlign: "center",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
    gap: theme.spacing[2],
  },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
