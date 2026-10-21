import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useWindowDimensions } from "react-native";
import {
  resolveDesktopSidebarWidth,
  SIDEBAR_EDGE_WIDTH,
} from "@/components/desktop-sidebar-layout";
import { getOverlayRoot, isTargetInWebOverlay } from "@/lib/overlay-root";
import { usePanelStore } from "@/stores/panel-store";
import { SidebarHoverContext } from "./hover-context";

const inlineStyle = { display: "flex" } as const;

export function DesktopSidebarSurface({
  overlay,
  active,
  onDismiss,
  children,
}: {
  overlay: boolean;
  active: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const inlineRef = useRef<HTMLDivElement>(null);
  const [host] = useState(() => document.createElement("div"));
  const [hoverHolds, setHoverHolds] = useState(0);
  const pointerRef = useRef<MouseEvent | undefined>(undefined);
  const hold = useCallback(() => {
    setHoverHolds((count) => count + 1);
    return () => setHoverHolds((count) => count - 1);
  }, []);
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const visibleSidebarWidth = resolveDesktopSidebarWidth({
    requestedWidth: sidebarWidth,
    viewportWidth,
  });

  useLayoutEffect(() => {
    const parent = overlay ? getOverlayRoot() : inlineRef.current;
    if (!parent) return;
    const scrollPositions = Array.from(host.querySelectorAll("*")).map((element) => ({
      element,
      top: element.scrollTop,
      left: element.scrollLeft,
    }));
    const surfaceWidth = active ? visibleSidebarWidth : SIDEBAR_EDGE_WIDTH;
    host.style.display = "flex";
    host.style.position = overlay ? "absolute" : "relative";
    host.style.inset = overlay ? "0 auto 0 0" : "";
    host.style.zIndex = "0";
    host.style.width = overlay ? `${surfaceWidth}px` : "";
    host.style.pointerEvents = overlay && active ? "auto" : "none";
    // Native drag regions swallow mouse events even beneath a web overlay.
    host.style.setProperty("-webkit-app-region", overlay ? "no-drag" : "");
    if (host.parentElement !== parent) parent.appendChild(host);
    // Changing portal parents resets descendant scroll offsets in browsers.
    for (const { element, top, left } of scrollPositions) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }, [active, host, overlay, visibleSidebarWidth]);

  useLayoutEffect(() => () => host.remove(), [host]);

  useLayoutEffect(() => {
    if (!overlay) return;
    function dismissOutside(event: MouseEvent) {
      pointerRef.current = event;
      if (event.buttons || hoverHolds) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const insideSurface =
        target instanceof Node && (host.contains(target) || isTargetInWebOverlay(target));
      if (insideSurface) return;
      onDismiss();
    }
    host.addEventListener("mouseleave", dismissOutside);
    // Entering an iframe still sends pointerover to its parent document.
    document.addEventListener("pointerover", dismissOutside);
    document.addEventListener("pointermove", dismissOutside);
    if (pointerRef.current) dismissOutside(pointerRef.current);
    return () => {
      host.removeEventListener("mouseleave", dismissOutside);
      document.removeEventListener("pointerover", dismissOutside);
      document.removeEventListener("pointermove", dismissOutside);
    };
  }, [host, hoverHolds, onDismiss, overlay]);

  // Move the portal host so pinning and collapsing preserve the sidebar's mounted state.
  return (
    <>
      <div ref={inlineRef} style={inlineStyle} />
      {createPortal(
        <SidebarHoverContext.Provider value={hold}>{children}</SidebarHoverContext.Provider>,
        host,
      )}
    </>
  );
}
