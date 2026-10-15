import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getOverlayRoot } from "@/lib/overlay-root";

const inlineStyle = { display: "flex" } as const;

export function DesktopSidebarSurface({
  overlay,
  onDismiss,
  children,
}: {
  overlay: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const inlineRef = useRef<HTMLDivElement>(null);
  const [host] = useState(() => document.createElement("div"));

  useLayoutEffect(() => {
    const parent = overlay ? getOverlayRoot() : inlineRef.current;
    if (!parent) return;
    host.style.display = "flex";
    host.style.position = overlay ? "absolute" : "relative";
    host.style.inset = overlay ? "0 auto 0 0" : "";
    host.style.pointerEvents = "none";
    host.style.zIndex = "0";
    parent.appendChild(host);
    return () => host.remove();
  }, [host, overlay]);

  useLayoutEffect(() => {
    if (!overlay) return;
    function handleMouseLeave(event: MouseEvent) {
      if (!event.buttons) onDismiss();
    }
    host.addEventListener("mouseleave", handleMouseLeave);
    return () => host.removeEventListener("mouseleave", handleMouseLeave);
  }, [host, onDismiss, overlay]);

  // Move the portal host so pinning and collapsing preserve the sidebar's mounted state.
  return (
    <>
      <div ref={inlineRef} style={inlineStyle} />
      {createPortal(children, host)}
    </>
  );
}
