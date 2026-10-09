import {
  collectAllPanes,
  removePaneFromTree,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { findAdjacentPane } from "@/utils/split-navigation";

export enum FilePaneAxis {
  Horizontal = "horizontal",
  Vertical = "vertical",
}

export enum FilePanePosition {
  Right = "right",
  Left = "left",
  Bottom = "bottom",
  Top = "top",
}

// oxlint-disable-next-line typescript-eslint/consistent-type-definitions
type FilePanePlacement = {
  sourcePaneId: string;
  paneId?: string;
  position: FilePanePosition;
};

export function resolveFilePanePlacement({
  layout,
  sourceTabId,
  explorerPaneId,
  axis,
}: {
  layout?: WorkspaceLayout;
  sourceTabId: string;
  explorerPaneId?: string | null;
  axis: FilePaneAxis;
}): FilePanePlacement | undefined {
  if (!layout) return;
  const sourcePane = collectAllPanes(layout.root).find((pane) => pane.tabIds.includes(sourceTabId));
  if (!sourcePane) return;
  // Explorer is docked outside the split canvas and must not become a split destination.
  const excludeExplorer = explorerPaneId && sourcePane.id !== explorerPaneId;
  const root = excludeExplorer ? removePaneFromTree(layout.root, explorerPaneId) : layout.root;
  const horizontal = axis === FilePaneAxis.Horizontal;
  const forward = findAdjacentPane(root, sourcePane.id, horizontal ? "right" : "down");
  const backward = findAdjacentPane(root, sourcePane.id, horizontal ? "left" : "up");
  let position = horizontal ? FilePanePosition.Right : FilePanePosition.Bottom;
  if (!forward && backward) {
    position = horizontal ? FilePanePosition.Left : FilePanePosition.Top;
  }
  return { sourcePaneId: sourcePane.id, paneId: forward ?? backward ?? undefined, position };
}
