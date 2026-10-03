import { createContext, useContext } from "react";

/** The "Compact chat" customization; the stream view reads the setting once and provides it. */
export const CompactChatContext = createContext(false);

export function useCompactChat(): boolean {
  return useContext(CompactChatContext);
}
