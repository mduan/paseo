import type { ReactNode } from "react";

export function DesktopSidebarSurface({
  children,
}: {
  overlay: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return children;
}
