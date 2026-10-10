import type { RevealInFileManagerAction } from "@/workspace/open-in-file-manager/reveal";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { i18n } from "@/i18n/i18next";
import { encodeFilePathForPathSegment, encodeWorkspaceIdForPathSegment } from "@/utils/host-routes";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";
import { findPaneContainingTab, type SplitNode } from "@/stores/workspace-layout-actions";
import { findAdjacentPane } from "@/utils/split-navigation";
import type { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

export enum PaneMovePosition {
  Left = "left",
  Right = "right",
  Top = "top",
  Bottom = "bottom",
}

export type WorkspaceTabMenuSurface = "desktop" | "mobile";

export interface WorkspaceTabMenuLabels {
  copyResumeCommand: string;
  copyAgentId: string;
  copyTerminalId: string;
  copyFilePath: string;
  revealInExplorer: string;
  rename: string;
  moveLeft: string;
  moveRight: string;
  moveTop: string;
  moveBottom: string;
  closeAbove: string;
  closeBelow: string;
  closeLeft: string;
  closeRight: string;
  closeOthers: string;
  reloadAgent: string;
  reloadAgentTooltip: string;
  close: string;
}

export const DEFAULT_WORKSPACE_TAB_MENU_LABELS: WorkspaceTabMenuLabels = {
  copyResumeCommand: i18n.t("workspace.tabs.menu.copyResumeCommand"),
  copyAgentId: i18n.t("workspace.tabs.menu.copyAgentId"),
  copyTerminalId: i18n.t("workspace.tabs.menu.copyTerminalId"),
  copyFilePath: i18n.t("workspace.tabs.menu.copyFilePath"),
  revealInExplorer: i18n.t("workspace.tabs.menu.revealInExplorer"),
  rename: i18n.t("workspace.tabs.menu.rename"),
  moveLeft: i18n.t("workspace.tabs.menu.moveLeft"),
  moveRight: i18n.t("workspace.tabs.menu.moveRight"),
  moveTop: i18n.t("workspace.tabs.menu.moveTop"),
  moveBottom: i18n.t("workspace.tabs.menu.moveBottom"),
  closeAbove: i18n.t("workspace.tabs.menu.closeAbove"),
  closeBelow: i18n.t("workspace.tabs.menu.closeBelow"),
  closeLeft: i18n.t("workspace.tabs.menu.closeLeft"),
  closeRight: i18n.t("workspace.tabs.menu.closeRight"),
  closeOthers: i18n.t("workspace.tabs.menu.closeOthers"),
  reloadAgent: i18n.t("workspace.tabs.menu.reloadAgent"),
  reloadAgentTooltip: i18n.t("workspace.tabs.menu.reloadAgentTooltip"),
  close: i18n.t("workspace.tabs.menu.close"),
};

export type WorkspaceTabMenuEntry =
  | {
      kind: "item";
      key: string;
      label: string;
      icon?:
        | "copy"
        | "folder-search"
        | "folder-open"
        | "rotate-cw"
        | "arrow-left-to-line"
        | "arrow-right-to-line"
        | "copy-x"
        | "sparkles"
        | "pencil"
        | "arrow-left"
        | "arrow-right"
        | "arrow-up"
        | "arrow-down"
        | "x";
      hint?: string;
      tooltip?: string;
      disabled?: boolean;
      destructive?: boolean;
      testID: string;
      onSelect: () => void;
    }
  | {
      kind: "separator";
      key: string;
    };

export type WorkspaceTabPaneMoves = Pick<
  ReturnType<typeof useWorkspaceLayoutStore.getState>,
  "moveTabToPane" | "splitPane"
> & {
  workspaceKey: string;
  root: SplitNode;
  explorerSidebarPaneId: string | null;
};

interface BuildWorkspaceTabMenuEntriesInput {
  surface: WorkspaceTabMenuSurface;
  tab: WorkspaceTabDescriptor;
  index: number;
  tabCount: number;
  menuTestIDBase: string;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onRevealFileInExplorer: (path: string) => void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onRenameTabWithAi?: (agentId: string) => void;
  renameWithAiPending?: boolean;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsBefore: (tabId: string) => Promise<void> | void;
  onCloseTabsAfter: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  labels?: WorkspaceTabMenuLabels;
  paneMoves?: WorkspaceTabPaneMoves;
  fileManager?: RevealInFileManagerAction;
}

interface BuildWorkspaceDesktopTabActionsInput {
  tab: WorkspaceTabDescriptor;
  index: number;
  tabCount: number;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onRevealFileInExplorer: (path: string) => void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onRenameTabWithAi?: (agentId: string) => void;
  renameWithAiPending?: boolean;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  labels?: WorkspaceTabMenuLabels;
  paneMoves?: WorkspaceTabPaneMoves;
  fileManager?: RevealInFileManagerAction;
}

export interface WorkspaceDesktopTabActions {
  contextMenuTestId: string;
  menuEntries: WorkspaceTabMenuEntry[];
  closeButtonTestId: string;
}

function buildCloseBeforeLabel(
  surface: WorkspaceTabMenuSurface,
  labels: WorkspaceTabMenuLabels,
): string {
  return surface === "mobile" ? labels.closeAbove : labels.closeLeft;
}

function buildCloseAfterLabel(
  surface: WorkspaceTabMenuSurface,
  labels: WorkspaceTabMenuLabels,
): string {
  return surface === "mobile" ? labels.closeBelow : labels.closeRight;
}

function buildCloseBeforeTestIDSuffix(surface: WorkspaceTabMenuSurface): string {
  return surface === "mobile" ? "close-above" : "close-left";
}

function buildCloseAfterTestIDSuffix(surface: WorkspaceTabMenuSurface): string {
  return surface === "mobile" ? "close-below" : "close-right";
}

function getCloseButtonTestId(tab: WorkspaceTabDescriptor): string {
  if (tab.target.kind === "agent") {
    return `workspace-agent-close-${tab.target.agentId}`;
  }
  if (tab.target.kind === "terminal") {
    return `workspace-terminal-close-${tab.target.terminalId}`;
  }
  if (tab.target.kind === "draft") {
    return `workspace-draft-close-${tab.target.draftId}`;
  }
  if (tab.target.kind === "browser") {
    return `workspace-browser-close-${tab.target.browserId}`;
  }
  if (tab.target.kind === "setup") {
    return `workspace-setup-close-${encodeWorkspaceIdForPathSegment(tab.target.workspaceId)}`;
  }
  if (tab.target.kind === "provider_subagent") {
    return `workspace-provider-subagent-close-${tab.target.subagentId}`;
  }
  if (tab.target.kind === "commit_diff") {
    return `workspace-commit-diff-close-${encodeFilePathForPathSegment(tab.target.sha)}`;
  }
  if (tab.target.kind === "turn_diff") {
    return `workspace-turn-diff-close-${encodeFilePathForPathSegment(buildDeterministicWorkspaceTabId(tab.target))}`;
  }
  if (tab.target.kind === "working_diff" || tab.target.kind === "changes_tree") {
    return `workspace-working-diff-close-${encodeFilePathForPathSegment(buildDeterministicWorkspaceTabId(tab.target))}`;
  }
  if (tab.target.kind === "files" || tab.target.kind === "pull_request") {
    return `workspace-${tab.target.kind}-close`;
  }
  if (tab.target.kind === "plugin") {
    return `workspace-plugin-close-${encodeFilePathForPathSegment(buildDeterministicWorkspaceTabId(tab.target))}`;
  }
  if (tab.target.kind === "new_tab") {
    return `workspace-new-tab-close-${tab.tabId}`;
  }
  return `workspace-file-close-${encodeFilePathForPathSegment(tab.target.path)}`;
}

export function buildWorkspaceTabMenuEntries(
  input: BuildWorkspaceTabMenuEntriesInput,
): WorkspaceTabMenuEntry[] {
  const {
    surface,
    tab,
    index,
    tabCount,
    menuTestIDBase,
    onCopyResumeCommand,
    onCopyAgentId,
    onCopyTerminalId,
    onCopyFilePath,
    onRevealFileInExplorer,
    onReloadAgent,
    onRenameTab,
    onCloseTab,
    onCloseTabsBefore,
    onCloseTabsAfter,
    onCloseOtherTabs,
  } = input;
  const labels = input.labels ?? DEFAULT_WORKSPACE_TAB_MENU_LABELS;
  const isFirstTab = index === 0;
  const isLastTab = index === tabCount - 1;
  const isOnlyTab = tabCount <= 1;
  const entries: WorkspaceTabMenuEntry[] = [];

  if (tab.target.kind === "agent") {
    const { agentId } = tab.target;
    entries.push({
      kind: "item",
      key: "copy-resume-command",
      label: labels.copyResumeCommand,
      icon: "copy",
      testID: `${menuTestIDBase}-copy-resume-command`,
      onSelect: () => {
        void onCopyResumeCommand(agentId);
      },
    });
    entries.push({
      kind: "item",
      key: "copy-agent-id",
      label: labels.copyAgentId,
      icon: "copy",
      hint: agentId.slice(0, 7),
      testID: `${menuTestIDBase}-copy-agent-id`,
      onSelect: () => {
        void onCopyAgentId(agentId);
      },
    });
  }

  if (tab.target.kind === "terminal") {
    const { terminalId } = tab.target;
    entries.push({
      kind: "item",
      key: "copy-terminal-id",
      label: labels.copyTerminalId,
      icon: "copy",
      hint: terminalId.slice(0, 7),
      testID: `${menuTestIDBase}-copy-terminal-id`,
      onSelect: () => {
        void onCopyTerminalId(terminalId);
      },
    });
  }

  if (tab.target.kind === "file") {
    const filePath = tab.target.path;
    entries.push({
      kind: "item",
      key: "copy-file-path",
      label: labels.copyFilePath,
      icon: "copy",
      testID: `${menuTestIDBase}-copy-file-path`,
      onSelect: () => {
        void onCopyFilePath(filePath);
      },
    });
    entries.push({
      kind: "item",
      key: "reveal-in-explorer",
      label: labels.revealInExplorer,
      icon: "folder-search",
      testID: `${menuTestIDBase}-reveal-in-explorer`,
      onSelect: () => {
        onRevealFileInExplorer(filePath);
      },
    });
    if (input.fileManager) {
      const { targetName, reveal } = input.fileManager;
      entries.push({
        kind: "item",
        key: "reveal-in-file-manager",
        label: i18n.t("workspace.fileActions.revealIn", { target: targetName }),
        icon: "folder-open",
        testID: `${menuTestIDBase}-reveal-in-file-manager`,
        onSelect: () => {
          void reveal(filePath);
        },
      });
    }
  }

  if (tab.target.kind === "agent" || tab.target.kind === "terminal") {
    entries.push({
      kind: "item",
      key: "rename",
      label: labels.rename,
      icon: "pencil",
      testID: `${menuTestIDBase}-rename`,
      onSelect: () => {
        onRenameTab(tab);
      },
    });
    const renameWithAi = input.onRenameTabWithAi;
    if (tab.target.kind === "agent" && renameWithAi) {
      const { agentId } = tab.target;
      entries.push({
        kind: "item",
        key: "rename-ai",
        label: i18n.t("workspace.tabs.menu.renameWithAi"),
        icon: "sparkles",
        disabled: input.renameWithAiPending,
        testID: `${menuTestIDBase}-rename-ai`,
        onSelect: () => renameWithAi(agentId),
      });
    }
    entries.push({
      kind: "separator",
      key: "rename-separator",
    });
  }

  const paneMoves = input.paneMoves;
  const sourcePane = paneMoves && findPaneContainingTab(paneMoves.root, tab.tabId);
  if (paneMoves && sourcePane && sourcePane.id !== paneMoves.explorerSidebarPaneId) {
    const moveLabels = {
      [PaneMovePosition.Left]: labels.moveLeft,
      [PaneMovePosition.Right]: labels.moveRight,
      [PaneMovePosition.Top]: labels.moveTop,
      [PaneMovePosition.Bottom]: labels.moveBottom,
    };
    const moveIcons = {
      [PaneMovePosition.Left]: "arrow-left",
      [PaneMovePosition.Right]: "arrow-right",
      [PaneMovePosition.Top]: "arrow-up",
      [PaneMovePosition.Bottom]: "arrow-down",
    } as const;
    const moves = [
      {
        position: PaneMovePosition.Right,
        direction: "right",
        oppositePosition: PaneMovePosition.Left,
        oppositeDirection: "left",
      },
      {
        position: PaneMovePosition.Bottom,
        direction: "down",
        oppositePosition: PaneMovePosition.Top,
        oppositeDirection: "up",
      },
    ] as const;
    for (const move of moves) {
      let position: PaneMovePosition = move.position;
      const options = { excludedPaneId: paneMoves.explorerSidebarPaneId };
      let toPaneId = findAdjacentPane(paneMoves.root, sourcePane.id, move.direction, options);
      if (!toPaneId) {
        toPaneId = findAdjacentPane(paneMoves.root, sourcePane.id, move.oppositeDirection, options);
        if (toPaneId) position = move.oppositePosition;
      }
      entries.push({
        kind: "item",
        key: `move-${position}`,
        label: moveLabels[position],
        icon: moveIcons[position],
        testID: `${menuTestIDBase}-move-${position}`,
        onSelect: () => {
          if (toPaneId) {
            paneMoves.moveTabToPane(paneMoves.workspaceKey, tab.tabId, toPaneId, {
              preserveSourcePane: true,
            });
          } else {
            paneMoves.splitPane(paneMoves.workspaceKey, {
              tabId: tab.tabId,
              targetPaneId: sourcePane.id,
              position,
            });
          }
        },
      });
    }
    entries.push({ kind: "separator", key: "move-separator" });
  }

  entries.push({
    kind: "item",
    key: "close-before",
    label: buildCloseBeforeLabel(surface, labels),
    icon: "arrow-left-to-line",
    disabled: isFirstTab,
    testID: `${menuTestIDBase}-${buildCloseBeforeTestIDSuffix(surface)}`,
    onSelect: () => {
      void onCloseTabsBefore(tab.tabId);
    },
  });
  entries.push({
    kind: "item",
    key: "close-after",
    label: buildCloseAfterLabel(surface, labels),
    icon: "arrow-right-to-line",
    disabled: isLastTab,
    testID: `${menuTestIDBase}-${buildCloseAfterTestIDSuffix(surface)}`,
    onSelect: () => {
      void onCloseTabsAfter(tab.tabId);
    },
  });
  entries.push({
    kind: "item",
    key: "close-others",
    label: labels.closeOthers,
    icon: "copy-x",
    disabled: isOnlyTab,
    testID: `${menuTestIDBase}-close-others`,
    onSelect: () => {
      void onCloseOtherTabs(tab.tabId);
    },
  });
  if (tab.target.kind === "agent") {
    const { agentId } = tab.target;
    entries.push({
      kind: "item",
      key: "reload-agent",
      label: labels.reloadAgent,
      icon: "rotate-cw",
      tooltip: labels.reloadAgentTooltip,
      testID: `${menuTestIDBase}-reload-agent`,
      onSelect: () => {
        void onReloadAgent(agentId);
      },
    });
  }
  entries.push({
    kind: "item",
    key: "close",
    label: labels.close,
    icon: "x",
    testID: `${menuTestIDBase}-close`,
    onSelect: () => {
      void onCloseTab(tab.tabId);
    },
  });

  return entries;
}

export function buildWorkspaceDesktopTabActions(
  input: BuildWorkspaceDesktopTabActionsInput,
): WorkspaceDesktopTabActions {
  const contextMenuTestId = `workspace-tab-context-${input.tab.tabId}`;
  return {
    contextMenuTestId,
    menuEntries: buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: input.tab,
      index: input.index,
      tabCount: input.tabCount,
      menuTestIDBase: contextMenuTestId,
      onCopyResumeCommand: input.onCopyResumeCommand,
      onCopyAgentId: input.onCopyAgentId,
      onCopyTerminalId: input.onCopyTerminalId,
      onCopyFilePath: input.onCopyFilePath,
      onRevealFileInExplorer: input.onRevealFileInExplorer,
      onReloadAgent: input.onReloadAgent,
      onRenameTab: input.onRenameTab,
      onRenameTabWithAi: input.onRenameTabWithAi,
      renameWithAiPending: input.renameWithAiPending,
      onCloseTab: input.onCloseTab,
      onCloseTabsBefore: input.onCloseTabsToLeft,
      onCloseTabsAfter: input.onCloseTabsToRight,
      onCloseOtherTabs: input.onCloseOtherTabs,
      labels: input.labels,
      paneMoves: input.paneMoves,
      fileManager: input.fileManager,
    }),
    closeButtonTestId: getCloseButtonTestId(input.tab),
  };
}
