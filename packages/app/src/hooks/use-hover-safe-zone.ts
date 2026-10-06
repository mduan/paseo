import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";
import { createHoverSafeZoneTracker, type RectLike } from "@/hooks/hover-safe-zone-tracker";

// How long the content stays open after the pointer leaves the safe zone.
const CLOSE_GRACE_MS = 100;

interface UseHoverSafeZoneParams {
  enabled: boolean;
  triggerRef: RefObject<View | null>;
  contentRef: RefObject<View | null>;
  onClose: () => void;
}

interface HoverSafeZone {
  scheduleClose: () => void;
  cancelClose: () => void;
}

function readRect(ref: RefObject<View | null>): RectLike | null {
  const node = ref.current as unknown as Element | null;
  return node ? node.getBoundingClientRect() : null;
}

export function useHoverSafeZone({
  enabled,
  triggerRef,
  contentRef,
  onClose,
}: UseHoverSafeZoneParams): HoverSafeZone {
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const cancelClose = useCallback(() => {
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current) return;
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = undefined;
      onCloseRef.current();
    }, CLOSE_GRACE_MS);
  }, []);

  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    if (!isWeb || !enabled) return;

    const tracker = createHoverSafeZoneTracker({
      getTriggerRect: () => readRect(triggerRef),
      getContentRect: () => readRect(contentRef),
      onEnterSafeZone: cancelClose,
      onLeaveSafeZone: scheduleClose,
    });

    function handlePointerMove(event: PointerEvent) {
      tracker.pointerMoved(event.clientX, event.clientY);
    }

    function handlePointerOut(event: PointerEvent) {
      if (event.relatedTarget === null) {
        tracker.pointerLeftWindow();
      }
    }

    function handleBlur() {
      tracker.windowBlurred();
    }

    document.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerout", handlePointerOut);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", handleBlur);
    };
  }, [enabled, triggerRef, contentRef, cancelClose, scheduleClose]);

  return { scheduleClose, cancelClose };
}
