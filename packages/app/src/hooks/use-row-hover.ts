import { useCallback, useState } from "react";
import type { PointerEvent as NativePointerEvent } from "react-native";
import { isWeb } from "@/constants/platform";
import { isInsideRect } from "@/hooks/hover-safe-zone-tracker";

export function useRowHover() {
  const [hovered, setHovered] = useState(false);
  const onPointerEnter = useCallback(() => setHovered(true), []);
  const onPointerLeave = useCallback((event: NativePointerEvent) => {
    const target: unknown = event.currentTarget;
    const nativeEvent = event.nativeEvent;
    if (
      isWeb &&
      nativeEvent instanceof MouseEvent &&
      !nativeEvent.relatedTarget &&
      target instanceof Element
    ) {
      // Electron can report an exit with no destination while the pointer is still inside.
      const { clientX, clientY } = nativeEvent;
      if (isInsideRect(target.getBoundingClientRect(), clientX, clientY)) return;
    }
    setHovered(false);
  }, []);
  return { hovered, onPointerEnter, onPointerLeave };
}
