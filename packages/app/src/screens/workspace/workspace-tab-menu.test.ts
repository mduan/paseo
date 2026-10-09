import { describe, expect, it, vi } from "vitest";
import {
  buildWorkspaceDesktopTabActions,
  buildWorkspaceTabMenuEntries,
  PaneMovePosition,
} from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  collectAllPanes,
  collectAllTabs,
  createWorkspaceLayoutStore,
  findPaneById,
  findPaneContainingTab,
  selectExplorerSidebarPaneId,
} from "@/stores/workspace-layout-store";

function createAgentTab(): WorkspaceTabDescriptor {
  return {
    key: "agent_123",
    tabId: "agent_123",
    kind: "agent",
    target: { kind: "agent", agentId: "agent-123" },
  };
}

function createPaneMoveFixture() {
  let nextId = 0;
  const store = createWorkspaceLayoutStore({
    createNodeId: (prefix) => `${prefix}_${++nextId}`,
    createFocusRestorationToken: () => `focus_${++nextId}`,
  });
  store.setState({ layoutByWorkspace: {} });
  const workspaceKey = "server-1:workspace-pane-moves";
  const tab = createAgentTab();
  const tabId = store.getState().openTab({ workspaceKey, target: tab.target, intent: "reveal" });
  if (!tabId) throw new Error("Expected agent tab");
  tab.tabId = tabId;
  tab.key = tabId;

  function buildMenu() {
    const state = store.getState();
    const layout = state.layoutByWorkspace[workspaceKey];
    const pane = findPaneContainingTab(layout.root, tab.tabId);
    if (!pane) throw new Error("Expected source pane");
    return buildWorkspaceDesktopTabActions({
      tab,
      index: pane.tabIds.indexOf(tab.tabId),
      tabCount: pane.tabIds.length,
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onRevealFileInExplorer: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsToLeft: vi.fn(),
      onCloseTabsToRight: vi.fn(),
      onCloseOtherTabs: vi.fn(),
      paneMoves: {
        root: layout.root,
        explorerSidebarPaneId: selectExplorerSidebarPaneId(state, workspaceKey),
        workspaceKey,
        moveTabToPane: state.moveTabToPane,
        splitPane: state.splitPane,
      },
    }).menuEntries;
  }

  function selectMove(position: PaneMovePosition) {
    const entry = buildMenu().find((item) => item.key === `move-${position}`);
    if (!entry || entry.kind !== "item") throw new Error(`Missing move to ${position}`);
    entry.onSelect();
  }

  return { store, workspaceKey, tab, buildMenu, selectMove };
}

describe("workspace tab pane moves", () => {
  it.each([
    [PaneMovePosition.Right, PaneMovePosition.Left, "Move to left pane"],
    [PaneMovePosition.Bottom, PaneMovePosition.Top, "Move to top pane"],
  ])(
    "creates and reuses a %s split without closing the empty source",
    (position, opposite, label) => {
      const { store, workspaceKey, tab, buildMenu, selectMove } = createPaneMoveFixture();
      const initialLayout = store.getState().layoutByWorkspace[workspaceKey];
      const sourcePaneId = findPaneContainingTab(initialLayout.root, tab.tabId)?.id;
      if (!sourcePaneId) throw new Error("Expected source pane");
      const initialTabs = collectAllTabs(initialLayout.root);

      const menuKeys = buildMenu().map((entry) => entry.key);
      expect(menuKeys.slice(menuKeys.indexOf("rename"), menuKeys.indexOf("close-before"))).toEqual([
        "rename",
        "rename-separator",
        "move-right",
        "move-bottom",
        "move-separator",
      ]);
      selectMove(position);

      const splitLayout = store.getState().layoutByWorkspace[workspaceKey];
      const destinationPaneId = findPaneContainingTab(splitLayout.root, tab.tabId)?.id;
      if (!destinationPaneId) throw new Error("Expected destination pane");
      expect(destinationPaneId).not.toBe(sourcePaneId);
      expect(collectAllPanes(splitLayout.root)).toHaveLength(2);
      expect(splitLayout.focusedPaneId).toBe(destinationPaneId);
      const placeholderId = findPaneById(splitLayout.root, sourcePaneId)?.focusedTabId;
      expect(
        collectAllTabs(splitLayout.root).find((item) => item.tabId === placeholderId)?.target,
      ).toEqual({ kind: "new_tab" });
      expect(buildMenu()).toContainEqual(
        expect.objectContaining({ key: `move-${opposite}`, label }),
      );

      selectMove(opposite);
      const returnedLayout = store.getState().layoutByWorkspace[workspaceKey];
      expect(collectAllPanes(returnedLayout.root)).toHaveLength(2);
      expect(findPaneById(returnedLayout.root, sourcePaneId)?.tabIds).toEqual([tab.tabId]);
      expect(returnedLayout.focusedPaneId).toBe(sourcePaneId);
      expect(collectAllTabs(returnedLayout.root).find((item) => item.tabId === tab.tabId)).toEqual(
        initialTabs.find((item) => item.tabId === tab.tabId),
      );
      expect(collectAllTabs(returnedLayout.root).some((item) => item.tabId === placeholderId)).toBe(
        false,
      );
    },
  );

  it.each([PaneMovePosition.Right, PaneMovePosition.Bottom])(
    "moves into an existing %s pane and keeps the other tabs",
    (position) => {
      const { store, workspaceKey, tab, selectMove } = createPaneMoveFixture();
      const state = store.getState();
      const otherTabId = state.openTab({
        workspaceKey,
        target: { kind: "terminal", terminalId: "terminal-1" },
        intent: "reveal",
      });
      const remainingTabId = state.openTab({
        workspaceKey,
        target: { kind: "file", path: "/repo/a.ts" },
        intent: "reveal",
      });
      if (!otherTabId || !remainingTabId) throw new Error("Expected other tabs");
      const sourcePaneId = findPaneContainingTab(
        store.getState().layoutByWorkspace[workspaceKey].root,
        tab.tabId,
      )?.id;
      if (!sourcePaneId) throw new Error("Expected source pane");
      const destinationPaneId = state.splitPane(workspaceKey, {
        tabId: otherTabId,
        targetPaneId: sourcePaneId,
        position,
      });
      const oppositePosition =
        position === PaneMovePosition.Right ? PaneMovePosition.Left : PaneMovePosition.Top;
      state.splitPaneEmpty(workspaceKey, {
        targetPaneId: sourcePaneId,
        position: oppositePosition,
      });

      selectMove(position);
      const layout = store.getState().layoutByWorkspace[workspaceKey];
      expect(collectAllPanes(layout.root)).toHaveLength(3);
      expect(findPaneById(layout.root, destinationPaneId)?.tabIds).toEqual([otherTabId, tab.tabId]);
      expect(findPaneById(layout.root, sourcePaneId)?.tabIds).toEqual([remainingTabId]);
    },
  );

  it("creates an ordinary split instead of moving into the Explorer sidebar", () => {
    const { store, workspaceKey, buildMenu, selectMove } = createPaneMoveFixture();
    const explorerPaneId = store.getState().showExplorerSidebar(workspaceKey);
    const before = findPaneById(
      store.getState().layoutByWorkspace[workspaceKey].root,
      explorerPaneId,
    );
    expect(buildMenu()).toContainEqual(
      expect.objectContaining({ key: "move-right", label: "Move to right pane" }),
    );
    expect(buildMenu().some((item) => item.key === "move-left")).toBe(false);

    selectMove(PaneMovePosition.Right);
    const layout = store.getState().layoutByWorkspace[workspaceKey];
    expect(collectAllPanes(layout.root)).toHaveLength(3);
    expect(findPaneById(layout.root, explorerPaneId)).toEqual(before);
  });

  it("moves a sole New tab without removing its source pane", () => {
    const { store, workspaceKey, tab, selectMove } = createPaneMoveFixture();
    selectMove(PaneMovePosition.Right);
    const before = store.getState().layoutByWorkspace[workspaceKey];
    const placeholder = collectAllTabs(before.root).find((item) => item.target.kind === "new_tab");
    if (!placeholder) throw new Error("Expected New tab placeholder");
    const sourcePaneId = findPaneContainingTab(before.root, placeholder.tabId)?.id;
    tab.tabId = placeholder.tabId;
    tab.key = placeholder.tabId;
    tab.kind = "new_tab";
    tab.target = placeholder.target;

    selectMove(PaneMovePosition.Right);
    const layout = store.getState().layoutByWorkspace[workspaceKey];
    expect(collectAllPanes(layout.root)).toHaveLength(2);
    expect(findPaneContainingTab(layout.root, placeholder.tabId)?.id).not.toBe(sourcePaneId);
    const replacementId = findPaneById(layout.root, sourcePaneId)?.focusedTabId;
    expect(replacementId).not.toBe(placeholder.tabId);
    expect(
      collectAllTabs(layout.root).find((item) => item.tabId === replacementId)?.target,
    ).toEqual({ kind: "new_tab" });
  });
});

describe("buildWorkspaceTabMenuEntries", () => {
  it("uses desktop tab ordering labels for desktop menus", () => {
    const onCopyResumeCommand = vi.fn();
    const onCopyAgentId = vi.fn();
    const onCopyFilePath = vi.fn();
    const onReloadAgent = vi.fn();
    const onRenameTab = vi.fn();
    const onCloseTab = vi.fn();
    const onCloseTabsBefore = vi.fn();
    const onCloseTabsAfter = vi.fn();
    const onCloseOtherTabs = vi.fn();

    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-context-agent_123",
      onCopyResumeCommand,
      onCopyAgentId,
      onCopyTerminalId: vi.fn(),
      onCopyFilePath,
      onRevealFileInExplorer: vi.fn(),
      onReloadAgent,
      onRenameTab,
      onCloseTab,
      onCloseTabsBefore,
      onCloseTabsAfter,
      onCloseOtherTabs,
    });

    expect(entries.filter((entry) => entry.kind === "item").map((entry) => entry.label)).toEqual([
      "Copy resume command",
      "Copy agent id",
      "Rename",
      "Close to the left",
      "Close to the right",
      "Close other tabs",
      "Reload agent",
      "Close",
    ]);
  });

  it("uses stacked ordering labels for mobile menus", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "mobile",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-menu-agent_123",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onRevealFileInExplorer: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries.filter((entry) => entry.kind === "item").map((entry) => entry.label)).toEqual([
      "Copy resume command",
      "Copy agent id",
      "Rename",
      "Close tabs above",
      "Close tabs below",
      "Close other tabs",
      "Reload agent",
      "Close",
    ]);
  });

  it("omits agent copy actions and rename for draft tabs", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "mobile",
      tab: {
        key: "draft_123",
        tabId: "draft_123",
        kind: "draft",
        target: { kind: "draft", draftId: "draft_123" },
      },
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-menu-draft_123",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onRevealFileInExplorer: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries.some((entry) => entry.kind === "item" && entry.label === "Copy agent id")).toBe(
      false,
    );
    expect(entries.some((entry) => entry.kind === "item" && entry.label === "Reload agent")).toBe(
      false,
    );
    expect(entries.some((entry) => entry.kind === "item" && entry.label === "Rename")).toBe(false);
    expect(entries.some((entry) => entry.kind === "separator")).toBe(false);
  });

  it("adds reload tooltip copy for agent tabs", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: createAgentTab(),
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-agent_123",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onRevealFileInExplorer: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries).toContainEqual(
      expect.objectContaining({
        kind: "item",
        key: "reload-agent",
        tooltip: "Reload agent to update skills, MCPs or login status.",
      }),
    );
  });

  it("invokes onRenameTab when the rename entry is selected for agent tabs", () => {
    const onRenameTab = vi.fn();
    const tab = createAgentTab();
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab,
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-agent_123",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onRevealFileInExplorer: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab,
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    const renameEntry = entries.find((entry) => entry.kind === "item" && entry.label === "Rename");
    if (!renameEntry || renameEntry.kind !== "item") {
      throw new Error("Rename entry missing");
    }
    renameEntry.onSelect();

    expect(onRenameTab).toHaveBeenCalledWith(tab);
  });

  it("includes copy id and rename for terminal tabs", () => {
    const onRenameTab = vi.fn();
    const onCopyTerminalId = vi.fn();
    const terminalTab: WorkspaceTabDescriptor = {
      key: "terminal_abc",
      tabId: "terminal_abc",
      kind: "terminal",
      target: { kind: "terminal", terminalId: "terminal-abc" },
    };
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: terminalTab,
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-terminal_abc",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId,
      onCopyFilePath: vi.fn(),
      onRevealFileInExplorer: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab,
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    const labels = entries.filter((entry) => entry.kind === "item").map((entry) => entry.label);
    expect(labels[0]).toBe("Copy terminal id");
    expect(labels[1]).toBe("Rename");
    expect(labels).not.toContain("Copy resume command");
    expect(labels).not.toContain("Copy agent id");
    expect(labels).not.toContain("Copy file path");
    expect(labels).not.toContain("Reload agent");

    const copyTerminalIdEntry = entries.find(
      (entry) => entry.kind === "item" && entry.key === "copy-terminal-id",
    );
    if (!copyTerminalIdEntry || copyTerminalIdEntry.kind !== "item") {
      throw new Error("Copy terminal id entry missing");
    }
    copyTerminalIdEntry.onSelect();
    expect(onCopyTerminalId).toHaveBeenCalledWith("terminal-abc");

    const renameEntry = entries.find((entry) => entry.kind === "item" && entry.label === "Rename");
    if (!renameEntry || renameEntry.kind !== "item") {
      throw new Error("Rename entry missing");
    }
    renameEntry.onSelect();
    expect(onRenameTab).toHaveBeenCalledWith(terminalTab);
  });

  it("includes copy file path and reveal in explorer for file tabs", () => {
    const onCopyFilePath = vi.fn();
    const onRevealFileInExplorer = vi.fn();
    const fileTab: WorkspaceTabDescriptor = {
      key: "file_abc",
      tabId: "file_abc",
      kind: "file",
      target: { kind: "file", path: "/some/path.ts", lineStart: 1, lineEnd: 10 },
    };
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: fileTab,
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-file_abc",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath,
      onRevealFileInExplorer,
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    const labels = entries.filter((entry) => entry.kind === "item").map((entry) => entry.label);
    expect(labels.slice(0, 2)).toEqual(["Copy file path", "Reveal in file explorer"]);
    expect(labels).not.toContain("Copy resume command");
    expect(labels).not.toContain("Copy agent id");
    expect(labels).not.toContain("Rename");
    expect(labels).not.toContain("Reload agent");

    const copyFilePathEntry = entries.find(
      (entry) => entry.kind === "item" && entry.key === "copy-file-path",
    );
    if (!copyFilePathEntry || copyFilePathEntry.kind !== "item") {
      throw new Error("Copy file path entry missing");
    }
    copyFilePathEntry.onSelect();
    expect(onCopyFilePath).toHaveBeenCalledWith("/some/path.ts");

    const revealEntry = entries.find(
      (entry) => entry.kind === "item" && entry.key === "reveal-in-explorer",
    );
    if (!revealEntry || revealEntry.kind !== "item") {
      throw new Error("Reveal in explorer entry missing");
    }
    revealEntry.onSelect();
    expect(onRevealFileInExplorer).toHaveBeenCalledWith("/some/path.ts");
  });

  it("uses a Changes close id for the working diff tab", () => {
    const actions = buildWorkspaceDesktopTabActions({
      tab: {
        key: "working_diff_abc",
        tabId: "working_diff_abc",
        kind: "working_diff",
        target: {
          kind: "working_diff",
          focusPath: "src/example.ts",
          focusRequestId: 1,
        },
      },
      index: 0,
      tabCount: 1,
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onRevealFileInExplorer: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsToLeft: vi.fn(),
      onCloseTabsToRight: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(actions.closeButtonTestId).toMatch(/^workspace-working-diff-close-/);
    expect(actions.menuEntries).not.toContainEqual(
      expect.objectContaining({ kind: "item", key: "copy-file-path" }),
    );
  });

  it("uses the same rename entry shape for agent and terminal tabs", () => {
    const terminalTab: WorkspaceTabDescriptor = {
      key: "terminal_abc",
      tabId: "terminal_abc",
      kind: "terminal",
      target: { kind: "terminal", terminalId: "terminal-abc" },
    };
    const menuTestIDBase = "workspace-tab-context";
    const sharedInput = {
      surface: "desktop" as const,
      index: 0,
      tabCount: 1,
      menuTestIDBase,
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onRevealFileInExplorer: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    };

    const agentEntries = buildWorkspaceTabMenuEntries({ ...sharedInput, tab: createAgentTab() });
    const terminalEntries = buildWorkspaceTabMenuEntries({ ...sharedInput, tab: terminalTab });

    const agentRename = agentEntries.find(
      (entry) => entry.kind === "item" && entry.key === "rename",
    );
    const terminalRename = terminalEntries.find(
      (entry) => entry.kind === "item" && entry.key === "rename",
    );
    if (!agentRename || agentRename.kind !== "item") throw new Error("Agent rename missing");
    if (!terminalRename || terminalRename.kind !== "item")
      throw new Error("Terminal rename missing");

    expect({
      key: agentRename.key,
      label: agentRename.label,
      icon: agentRename.icon,
      testID: agentRename.testID,
    }).toEqual({
      key: terminalRename.key,
      label: terminalRename.label,
      icon: terminalRename.icon,
      testID: terminalRename.testID,
    });

    const agentSeparator = agentEntries
      .slice(agentEntries.indexOf(agentRename) + 1)
      .find((entry) => entry.kind === "separator");
    const terminalSeparator = terminalEntries
      .slice(terminalEntries.indexOf(terminalRename) + 1)
      .find((entry) => entry.kind === "separator");
    expect(agentSeparator?.key).toBe("rename-separator");
    expect(terminalSeparator?.key).toBe("rename-separator");
  });
});
