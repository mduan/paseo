import { createContext, useCallback, useContext, useEffect, useId, useRef } from "react";

interface HoverOverlayEntry {
  close: () => void;
  parentId?: string;
}

const activeHoverOverlays = new Map<string, HoverOverlayEntry>();

const HoverOverlayParentContext = createContext<string | undefined>(undefined);

export const HoverOverlayParentProvider = HoverOverlayParentContext.Provider;

function isAncestorOverlay(candidateId: string, parentId: string | undefined): boolean {
  let current = parentId;
  while (current !== undefined) {
    if (current === candidateId) return true;
    current = activeHoverOverlays.get(current)?.parentId;
  }
  return false;
}

export function claimExclusiveHoverOverlay({
  id,
  close,
  parentId,
}: {
  id: string;
  close: () => void;
  parentId?: string;
}): void {
  for (const [entryId, entry] of Array.from(activeHoverOverlays.entries())) {
    if (entryId === id) continue;
    if (isAncestorOverlay(entryId, parentId) || isAncestorOverlay(id, entry.parentId)) {
      continue;
    }
    activeHoverOverlays.delete(entryId);
    entry.close();
  }
  activeHoverOverlays.set(id, { close, parentId });
}

export function releaseExclusiveHoverOverlay(id: string): void {
  activeHoverOverlays.delete(id);
}

/**
 * Ensures at most one top-level hover card or tooltip is open at a time,
 * while allowing nested tooltips inside an open hover card to stay open
 * without dismissing their ancestor.
 */
export function useExclusiveHoverOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): {
  overlayId: string;
  claim: () => void;
} {
  const overlayId = useId();
  const parentId = useContext(HoverOverlayParentContext);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stableClose = useCallback(() => {
    onCloseRef.current();
  }, []);

  const claim = useCallback(() => {
    claimExclusiveHoverOverlay({
      id: overlayId,
      close: stableClose,
      parentId,
    });
  }, [overlayId, parentId, stableClose]);

  useEffect(() => {
    if (open) {
      claim();
      return () => {
        releaseExclusiveHoverOverlay(overlayId);
      };
    }
    releaseExclusiveHoverOverlay(overlayId);
    return undefined;
  }, [claim, open, overlayId]);

  return { overlayId, claim };
}
