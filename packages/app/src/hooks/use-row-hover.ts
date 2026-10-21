import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as NativePointerEvent } from "react-native";
import { isWeb } from "@/constants/platform";
import { isInsideRect } from "@/hooks/hover-safe-zone-tracker";

export function useRowHover() {
  const [hovered, setHovered] = useState(false);
  const targetRef = useRef<Element | undefined>(undefined);
  const onPointerEnter = useCallback((event: NativePointerEvent) => {
    const target: unknown = event.currentTarget;
    if (isWeb && target instanceof Element) targetRef.current = target;
    setHovered(true);
  }, []);
  useEffect(() => {
    if (!isWeb || !hovered) return;

    function dismiss() {
      setHovered(false);
    }
    function handlePointer(event: PointerEvent) {
      if (event.target instanceof Node && !targetRef.current?.contains(event.target)) dismiss();
    }

    // An ignored native exit may not be followed by another exit from this row.
    document.addEventListener("pointerover", handlePointer);
    document.addEventListener("pointermove", handlePointer);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerover", handlePointer);
      document.removeEventListener("pointermove", handlePointer);
      window.removeEventListener("blur", dismiss);
    };
  }, [hovered]);
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
