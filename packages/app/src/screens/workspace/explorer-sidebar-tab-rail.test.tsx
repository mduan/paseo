/** @vitest-environment jsdom */
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraggableListProps } from "@/components/draggable-list.types";
import type { WorkspaceDesktopTabRowItem } from "./workspace-desktop-tabs-row";
import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";
import type { WorkspaceTabPresentation } from "./workspace-tab-presentation";
import { ExplorerSidebarTabRail } from "./explorer-sidebar-tab-rail";

vi.stubGlobal("React", React);

vi.mock("@/components/sortable-inline-list", () => ({
  SortableInlineList: ({ data, renderItem }: DraggableListProps<WorkspaceDesktopTabRowItem>) =>
    data.map((item, index) => (
      <React.Fragment key={item.tab.tabId}>
        {renderItem({ item, index, drag: vi.fn(), isActive: false })}
      </React.Fragment>
    )),
}));

vi.mock("@/screens/workspace/workspace-tab-presentation", () => ({
  WorkspaceTabIcon: () => null,
  WorkspaceTabPresentationResolver: ({
    tab,
    children,
  }: {
    tab: WorkspaceTabDescriptor;
    children: (presentation: WorkspaceTabPresentation) => ReactNode;
  }) =>
    children({
      key: tab.key,
      kind: tab.kind,
      label: tab.kind,
      subtitle: "",
      tooltip: tab.kind,
      modified: false,
      titleState: "ready",
      icon: () => null,
      statusBucket: null,
    }),
}));

vi.mock("@/workspace-tabs/launcher", () => ({ useWorkspaceTabLaunchCatalog: () => [] }));
vi.mock("@/plugins/workspace-panels/locations", () => ({ panelTargetSupportsHost: () => false }));
vi.mock("@/components/ui/context-menu", () => {
  const Content = ({ children }: { children?: ReactNode }) => children;
  return {
    ContextMenu: Content,
    ContextMenuTrigger: ({
      children,
      testID,
      onPress,
    }: {
      children?: ReactNode;
      testID?: string;
      onPress?: () => void;
    }) => (
      <button type="button" data-testid={testID} onClick={onPress}>
        {children}
      </button>
    ),
    ContextMenuContent: () => null,
    ContextMenuItem: () => null,
    ContextMenuSeparator: () => null,
  };
});
vi.mock("@/components/ui/tooltip", () => {
  const Content = ({ children }: { children?: ReactNode }) => children;
  return { Tooltip: Content, TooltipTrigger: Content, TooltipContent: () => null };
});

afterEach(cleanup);

function renderRail() {
  const onCloseTab = vi.fn();
  const onNavigateTab = vi.fn();
  const targets: WorkspaceTabDescriptor["target"][] = [
    { kind: "files" },
    { kind: "changes_tree" },
    { kind: "file", path: "README.md" },
    { kind: "working_diff" },
  ];
  const tabs = targets.map((target) => ({
    tab: { key: target.kind, tabId: target.kind, kind: target.kind, target },
    isActive: false,
    isCloseHovered: false,
    isClosingTab: false,
  }));
  render(
    <ExplorerSidebarTabRail
      paneId="explorer"
      tabs={tabs}
      normalizedServerId="server"
      normalizedWorkspaceId="workspace"
      activeDragTabId={null}
      tabDropPreviewIndex={null}
      onNavigateTab={onNavigateTab}
      onCloseTab={onCloseTab}
      onCreateNewTab={vi.fn()}
      onMoveTabToMain={vi.fn()}
      onReorderTabs={vi.fn()}
    />,
  );
  return { onCloseTab, onNavigateTab };
}

describe("Explorer tab closing", () => {
  it("omits the X and ignores middle clicks for Files and Changes", () => {
    const { onCloseTab } = renderRail();
    for (const kind of ["files", "changes_tree"]) {
      expect(screen.queryByTestId(`explorer-sidebar-tab-close-${kind}`)).toBeNull();
      fireEvent(
        screen.getByTestId(`explorer-sidebar-tab-${kind}`),
        new MouseEvent("auxclick", { button: 1, bubbles: true }),
      );
    }
    expect(onCloseTab).not.toHaveBeenCalled();
  });

  it.each(["file", "working_diff"])("closes %s with middle click without selecting it", (kind) => {
    const { onCloseTab, onNavigateTab } = renderRail();
    expect(screen.getByTestId(`explorer-sidebar-tab-close-${kind}`)).not.toBeNull();
    const tab = screen.getByTestId(`explorer-sidebar-tab-${kind}`);
    fireEvent(tab, new MouseEvent("auxclick", { button: 2, bubbles: true }));
    expect(onCloseTab).not.toHaveBeenCalled();
    const middleClick = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    fireEvent(tab, middleClick);
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith(kind);
    expect(onNavigateTab).not.toHaveBeenCalled();
    expect(middleClick.defaultPrevented).toBe(true);
  });
});
