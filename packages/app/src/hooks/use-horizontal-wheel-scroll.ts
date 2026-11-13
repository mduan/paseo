import { useEffect, useRef } from "react";
import type { ScrollView } from "react-native";
import { isWeb } from "@/constants/platform";

export function useHorizontalWheelScroll({ enabled }: { enabled: boolean }) {
  const ref = useRef<ScrollView>(null);

  useEffect(() => {
    if (!isWeb || !enabled) return;
    const scrollableNode: unknown = ref.current?.getScrollableNode();
    if (!(scrollableNode instanceof HTMLElement)) return;
    const node = scrollableNode;

    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

      let delta = event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= node.clientWidth;
      event.preventDefault();
      node.scrollLeft += delta;
    }

    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [enabled]);

  return ref;
}
