import type { StreamItem } from "@/types/stream";
import { SPACING } from "@/styles/theme";

const isToolSequenceItem = (item?: StreamItem | null) =>
  item?.kind === "tool_call" || item?.kind === "thought" || item?.kind === "todo_list";

// ponytail: assumes assistant text ends in a paragraph margin; lists or code blocks that end a
// message can land a few px off.
const TOOL_ROW_INSET = SPACING[1] + 1; // padding + border of a tool row
const PARAGRAPH_TRAILING_MARGIN = SPACING[3];
const ROW_GAP = SPACING[1];

/** Text between tool rows sits at the same spacing as the rows themselves. */
export function getGapBetweenStreamItems(item: StreamItem, belowItem: StreamItem | null): number {
  if (item.kind === "user_message") {
    if (!belowItem || belowItem.kind === "assistant_message") return 0;
    return belowItem.kind === "user_message" ? SPACING[1] : SPACING[4];
  }
  if (isToolSequenceItem(item) && belowItem?.kind === "assistant_message") {
    return ROW_GAP + TOOL_ROW_INSET;
  }
  if (item.kind === "assistant_message" && isToolSequenceItem(belowItem)) {
    return ROW_GAP + TOOL_ROW_INSET - PARAGRAPH_TRAILING_MARGIN;
  }
  return ROW_GAP;
}
