import {
  collectAllPanes,
  collectAllTabs,
  createWorkspaceLayoutWithExplorerSidebar,
  DEFAULT_PANE_ID,
  findPaneContainingTab,
  resolveExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { OpenInSidePanePreferences, PullRequestOpenLocation } from "@/hooks/use-settings";
import { TurnDiffOpenLocation } from "@/hooks/use-settings/storage";
import { FilePaneAxis } from "@/workspace/file-open/pane";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  isExplorerSidebarOpen,
  openExplorerSidebarView,
  usesCompactExplorerSidebar,
  type ExplorerSidebarView,
} from "@/workspace-tabs/explorer-sidebar";
import {
  openPreferredWorkspaceTarget,
  openWorkspaceTargetAtLocation,
  openWorkspaceTargetInAdjacentPane,
} from "@/workspace-tabs/open-beside";

interface WorkspaceViewInput {
  isCompact: boolean;
  workspaceKey: string | null;
  checkout: ExplorerCheckoutContext | null;
  supportsPaneSplits?: boolean;
}

interface OpenWorkspaceChangesInput extends WorkspaceViewInput {
  preferences: OpenInSidePanePreferences;
}

interface OpenWorkspacePullRequestInput extends WorkspaceViewInput {
  destination: PullRequestOpenLocation;
}

function openExplorerView(input: WorkspaceViewInput, view: ExplorerSidebarView): void {
  openExplorerSidebarView({ ...input, view });
}

/** Opens the workspace Changes view according to the current layout and diff preference. */
export function openWorkspaceChanges(input: OpenWorkspaceChangesInput): string | null {
  if (usesCompactExplorerSidebar(input)) {
    openExplorerView(input, "changes");
    return null;
  }
  return openPreferredWorkspaceTarget({
    isCompact: input.isCompact,
    workspaceKey: input.workspaceKey,
    target: { kind: "working_diff" },
    source: "diffs",
    preferences: input.preferences,
  });
}

/** Reveals Changes from the composer, then opens its diff on a subsequent desktop action. */
export function openComposerChanges(input: OpenWorkspaceChangesInput): string | null {
  if (usesCompactExplorerSidebar(input) || isExplorerSidebarOpen(input)) {
    return openWorkspaceChanges(input);
  }
  openExplorerView(input, "changes");
  return null;
}

/** Opens the workspace pull request at its semantic destination. */
export function openWorkspacePullRequest(input: OpenWorkspacePullRequestInput): string | null {
  if (usesCompactExplorerSidebar(input) || input.destination === "explorer") {
    openExplorerView(input, "pr");
    return null;
  }
  return openWorkspaceTargetAtLocation({
    isCompact: input.isCompact,
    workspaceKey: input.workspaceKey,
    target: { kind: "pull_request" },
    location: input.destination,
  });
}

/** Opens a turn's diff at the "Opening a turn's changes from a chat" destination. */
export function openTurnDiff(input: {
  isCompact: boolean;
  workspaceKey: string | null;
  target: Extract<WorkspaceTabTarget, { kind: "turn_diff" }>;
  destination: TurnDiffOpenLocation;
  sourceTabId: string;
}): string | null {
  if (!input.workspaceKey) return null;
  const isDesktop = !usesCompactExplorerSidebar(input);
  const isAdjacent =
    input.destination === TurnDiffOpenLocation.Horizontal ||
    input.destination === TurnDiffOpenLocation.Vertical;
  if (isDesktop && isAdjacent) {
    return openWorkspaceTargetInAdjacentPane({
      workspaceKey: input.workspaceKey,
      target: input.target,
      parentTabId: input.sourceTabId,
      axis:
        input.destination === TurnDiffOpenLocation.Horizontal
          ? FilePaneAxis.Horizontal
          : FilePaneAxis.Vertical,
    });
  }
  if (isDesktop && input.destination === TurnDiffOpenLocation.Main) {
    const store = useWorkspaceLayoutStore.getState();
    const layout = store.layoutByWorkspace[input.workspaceKey];
    const pane = layout && findPaneContainingTab(layout.root, input.sourceTabId);
    if (!pane) return null;
    return store.openTab({
      workspaceKey: input.workspaceKey,
      target: input.target,
      parentTabId: input.sourceTabId,
      intent: "reveal",
      placement: { mode: "pane", paneId: pane.id },
    });
  }
  if (input.destination === TurnDiffOpenLocation.Explorer && isDesktop) {
    const store = useWorkspaceLayoutStore.getState();
    const paneId = store.showExplorerSidebar(input.workspaceKey);
    return store.openTab({
      workspaceKey: input.workspaceKey,
      target: input.target,
      intent: "reveal",
      placement: paneId ? { mode: "pane", paneId } : undefined,
    });
  }
  // Compact layouts have no Explorer pane to hold a diff, so it opens full screen.
  return openWorkspaceTargetAtLocation({
    isCompact: input.isCompact,
    workspaceKey: input.workspaceKey,
    target: input.target,
    location: input.destination === "side" ? "side" : "main",
  });
}

/** Adds a detected desktop PR once without revealing or selecting its destination. */
export function autoOpenWorkspacePullRequest(input: {
  workspaceKey: string | null;
  destination: PullRequestOpenLocation;
}): string | null {
  if (!input.workspaceKey) return null;
  const workspaceKey = input.workspaceKey;
  const store = useWorkspaceLayoutStore.getState();
  return store.autoOpenPullRequestTab(workspaceKey, () => {
    const layout =
      store.layoutByWorkspace[workspaceKey] ?? createWorkspaceLayoutWithExplorerSidebar();
    // A background open finds an existing PR tab wherever the user left it.
    if (collectAllTabs(layout.root).some((tab) => tab.target.kind === "pull_request")) {
      return {};
    }
    const explorerPaneId = resolveExplorerSidebarPaneId(
      layout,
      store.explorerSidebarPaneIdByWorkspace[workspaceKey],
    );
    let paneId = explorerPaneId;
    if (input.destination === "side") {
      paneId = store.ensureSidePane(workspaceKey, { focus: false });
    } else if (input.destination === "main") {
      const panes = collectAllPanes(layout.root);
      const mainPane =
        panes.find((pane) => pane.id === DEFAULT_PANE_ID) ??
        panes.find((pane) => pane.id !== explorerPaneId && !pane.hidden);
      paneId = mainPane?.id ?? null;
    }
    const changes =
      input.destination === "explorer"
        ? collectAllTabs(layout.root).find(
            (tab) =>
              tab.target.kind === "changes_tree" &&
              findPaneContainingTab(layout.root, tab.tabId)?.id === paneId,
          )
        : undefined;
    return {
      placement: paneId ? { mode: "prefer", paneId } : undefined,
      insertionPosition: changes ? { afterTabId: changes.tabId } : undefined,
    };
  });
}
