import { useCallback, useEffect, useRef, useState } from "react";

/** Immediate reveal, with time to cross neighboring rows on the way to the revealed surface. */
export function useHoverIntent() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);
  useEffect(() => cancelClose, [cancelClose]);
  const openNow = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    if (closeTimer.current) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = undefined;
      setOpen(false);
    }, 500);
  }, []);
  return { open, openNow, scheduleClose, cancelClose };
}
