import { create } from "zustand";

export interface ExplorerRevealRequest {
  workspaceStateKey: string;
  /** Workspace-relative file path. */
  path: string;
}

/**
 * One pending "reveal this file" request. The Files pane for the matching workspace consumes it,
 * whether it is already mounted or mounts because the request also opened the Files view.
 */
export const useExplorerRevealStore = create<{ request?: ExplorerRevealRequest }>(() => ({}));

export function requestExplorerReveal(request: ExplorerRevealRequest): void {
  useExplorerRevealStore.setState({ request });
}
