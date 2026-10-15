import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useWindowDimensions } from "react-native";
import { resolveDesktopSidebarWidth } from "@/components/desktop-sidebar-layout";
import { getOverlayRoot, isTargetInWebOverlay } from "@/lib/overlay-root";
import { usePanelStore } from "@/stores/panel-store";

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
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const visibleSidebarWidth = resolveDesktopSidebarWidth({
    requestedWidth: sidebarWidth,
    viewportWidth,
  });

  useLayoutEffect(() => {
    const parent = overlay ? getOverlayRoot() : inlineRef.current;
    if (!parent) return;
    host.style.display = "flex";
    host.style.position = overlay ? "absolute" : "relative";
    host.style.inset = overlay ? "0 auto 0 0" : "";
    host.style.zIndex = "0";
    parent.appendChild(host);
    return () => host.remove();
  }, [host, overlay]);

  useLayoutEffect(() => {
    host.style.width = overlay ? `${visibleSidebarWidth}px` : "";
    host.style.pointerEvents = overlay && active ? "auto" : "none";
  }, [active, host, overlay, visibleSidebarWidth]);

  useLayoutEffect(() => {
    if (!overlay) return;
    function dismissOutside(event: MouseEvent) {
      if (event.buttons) return;
      const target = event.type === "mouseleave" ? event.relatedTarget : event.target;
      const insideSurface =
        target instanceof Node && (host.contains(target) || isTargetInWebOverlay(target));
      if (insideSurface) return;
      onDismiss();
    }
    host.addEventListener("mouseleave", dismissOutside);
    // Entering an iframe still sends pointerover to its parent document.
    document.addEventListener("pointerover", dismissOutside);
    return () => {
      host.removeEventListener("mouseleave", dismissOutside);
      document.removeEventListener("pointerover", dismissOutside);
    };
  }, [host, onDismiss, overlay]);

  // Move the portal host so pinning and collapsing preserve the sidebar's mounted state.
  return (
    <>
      <div ref={inlineRef} style={inlineStyle} />
      {createPortal(children, host)}
    </>
  );
}
