import { useCallback, useEffect, useState } from "react";
import type { PointerEvent as RNPointerEvent } from "react-native";
import { isWeb } from "@/constants/platform";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";

export function useSidebarEdgeHover({ enabled }: { enabled: boolean }) {
  const finePointer = useHasFinePointer();
  const [revealed, setRevealed] = useState(false);
  const dismiss = useCallback(() => setRevealed(false), []);
  const revealOnPointerMove = useCallback((event: RNPointerEvent) => {
    if (event.nativeEvent.pointerType === "mouse" && !event.nativeEvent.buttons) setRevealed(true);
  }, []);
  const canReveal = enabled && finePointer;

  useEffect(() => {
    dismiss();
    if (!isWeb || !canReveal) return;

    function handlePointerOut(event: PointerEvent) {
      if (event.relatedTarget === null) dismiss();
    }

    window.addEventListener("pointerout", handlePointerOut);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", dismiss);
    };
  }, [canReveal, dismiss]);

  return {
    revealed: canReveal && revealed,
    canReveal,
    revealOnPointerMove,
    dismiss,
  };
}
