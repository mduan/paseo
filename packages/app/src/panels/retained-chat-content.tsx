import { useState, type ReactNode } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useIsMobilePanelActive } from "@/mobile-panels/provider";

/**
 * Native: a hidden chat stays mounted and keeps rendering. Suspending a retained
 * native subtree hides its host views, tears down layout effects, and detaches
 * refs, which changes Fabric ownership (docs/mobile-panels.md). Activity-gated
 * work already stops through the retained-panel signal.
 *
 * On compact layouts the chat's first mount waits until the agent panel settles.
 * Mounting it during the slide pauses the slide (docs/mobile-panels.md). Once
 * mounted, it stays mounted when another panel opens.
 */
export function RetainedChatContent({ children }: { children: ReactNode }) {
  const isCompact = useIsCompactFormFactor();
  const isAgentPanelSettled = useIsMobilePanelActive("agent");
  const canMount = !isCompact || isAgentPanelSettled;
  const [hasMounted, setHasMounted] = useState(canMount);
  if (canMount && !hasMounted) {
    setHasMounted(true);
  }
  return hasMounted ? children : null;
}
