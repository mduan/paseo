import type { StreamItem } from "@/types/stream";
import { SPACING } from "@/styles/theme";

export function isSameAssistantBlockGroup(params: {
  item: StreamItem | null | undefined;
  other: StreamItem | null | undefined;
}): boolean {
  return (
    params.item?.kind === "assistant_message" &&
    params.other?.kind === "assistant_message" &&
    params.item.blockGroupId !== undefined &&
    params.item.blockGroupId === params.other.blockGroupId
  );
}

export function getAssistantBlockSpacing(params: {
  item: StreamItem;
  aboveItem: StreamItem | null | undefined;
  belowItem: StreamItem | null | undefined;
  hasFooterBelow?: boolean;
}): "default" | "compactTop" | "compactBottom" | "compactBoth" {
  if (params.item.kind !== "assistant_message") {
    return "default";
  }
  const compactTop = isSameAssistantBlockGroup({ item: params.item, other: params.aboveItem });
  const compactBottom =
    params.hasFooterBelow ||
    isSameAssistantBlockGroup({ item: params.item, other: params.belowItem });
  if (compactTop && compactBottom) return "compactBoth";
  if (compactTop) return "compactTop";
  if (compactBottom) return "compactBottom";
  return "default";
}

const isUserMessageItem = (item?: StreamItem | null) => item?.kind === "user_message";
const isToolSequenceItem = (item?: StreamItem | null) =>
  item?.kind === "tool_call" || item?.kind === "thought" || item?.kind === "todo_list";

export function getGapBetweenStreamItems(
  item: StreamItem | null,
  belowItem: StreamItem | null,
): number {
  if (!item || !belowItem) {
    return 0;
  }

  if (isUserMessageItem(item) && isUserMessageItem(belowItem)) {
    return SPACING[1];
  }
  if (item.kind === "user_message" && belowItem.kind === "assistant_message") {
    return 0;
  }
  if (isToolSequenceItem(item) && isToolSequenceItem(belowItem)) {
    return 0;
  }
  if (item.kind === "user_message" && isToolSequenceItem(belowItem)) {
    return SPACING[4];
  }
  if (item.kind === "assistant_message" && isToolSequenceItem(belowItem)) {
    return SPACING[1];
  }
  if (isToolSequenceItem(item) && belowItem.kind === "assistant_message") {
    return SPACING[1];
  }
  if (isSameAssistantBlockGroup({ item, other: belowItem })) {
    return SPACING[3];
  }
  return SPACING[4];
}

// ponytail: assumes assistant text ends in a paragraph margin; lists or code blocks that end a
// message can land a few px off.
const TOOL_ROW_INSET = SPACING[1] + 1; // padding + border of a tool row
const PARAGRAPH_TRAILING_MARGIN = SPACING[3];
const COMPACT_ROW_GAP = SPACING[1];

/** Compact chat gaps, so text between tool rows sits at the same spacing as the rows themselves. */
export function getCompactGapBetweenStreamItems(
  item: StreamItem,
  belowItem: StreamItem | null,
): number {
  if (isToolSequenceItem(item) && belowItem?.kind === "assistant_message") {
    return COMPACT_ROW_GAP + TOOL_ROW_INSET;
  }
  if (item.kind === "assistant_message" && isToolSequenceItem(belowItem)) {
    return COMPACT_ROW_GAP + TOOL_ROW_INSET - PARAGRAPH_TRAILING_MARGIN;
  }
  return COMPACT_ROW_GAP;
}
