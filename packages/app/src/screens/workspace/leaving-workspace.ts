import { makeMutable } from "react-native-reanimated";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { areWorkspaceSelectionsEqual, getWorkspaceSelectionKey } from "./workspace-deck-retention";

/**
 * Native retains one workspace, so switching renders the next one in a long JS commit. Until
 * that commit lands, the deck hides the workspace being left on the UI thread instead of
 * showing its stale chat. The deck clears this once the route's workspace changes.
 */
export const leavingWorkspaceKey = makeMutable<string | undefined>(undefined);

export function markLeavingWorkspace({
  from,
  route,
}: {
  from: ActiveWorkspaceSelection | null;
  route: string;
}): void {
  const target = parseHostWorkspaceRouteFromPathname(route);
  if (from && target && !areWorkspaceSelectionsEqual(from, target)) {
    leavingWorkspaceKey.value = getWorkspaceSelectionKey(from);
  }
}
