import type { ReactNode } from "react";

export function DesktopSidebarSurface({
  children,
}: {
  overlay: boolean;
  active: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return children;
}
