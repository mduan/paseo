import { createContext, useContext, useEffect } from "react";

export const SidebarHoverContext = createContext<(() => () => void) | undefined>(undefined);

export function useKeepSidebarRevealed(active: boolean): void {
  const hold = useContext(SidebarHoverContext);
  useEffect(() => {
    if (active) return hold?.();
  }, [active, hold]);
}
