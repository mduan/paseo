import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { isLikelyExternalToolName } from "@getpaseo/protocol/tool-name-normalization";
import { buildToolCallDisplayModel } from "@getpaseo/protocol/tool-call-display";
import { type TimelineProjectionEntry, projectTimelineRows } from "./timeline-projection.js";

const DEFAULT_MAX_ITEMS = 0;
const MAX_TOOL_INPUT_CHARS = 400;
const MAX_TOOL_SUMMARY_CHARS = 200;

interface ActivityCuratorOptions {
  maxItems?: number;
  labelAssistantMessages?: boolean;
  includeKinds?: readonly AgentTimelineItem["type"][];
  includeExternalToolInput?: boolean;
}

interface ActivityEntry {
  text: string;
}

type TextAgentAttachment = Extract<AgentAttachment, { type: "text" }>;

function appendText(buffer: string, text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return buffer;
  }
  if (!buffer) {
    return normalized;
  }
  return `${buffer}\n${normalized}`;
}

function activityEntry(text: string): ActivityEntry {
  return { text };
}

function flushBuffers(
  entries: ActivityEntry[],
  buffers: { message: string; thought: string },
  options?: ActivityCuratorOptions,
) {
  if (buffers.message.trim()) {
    const text = buffers.message.trim();
    entries.push(activityEntry(options?.labelAssistantMessages ? `[Assistant] ${text}` : text));
  }
  if (buffers.thought.trim()) {
    const text = buffers.thought.trim();
    entries.push(activityEntry(`[Thought] ${text}`));
  }
  buffers.message = "";
  buffers.thought = "";
}

function formatToolInputJson(input: unknown): string | null {
  if (input === undefined) {
    return null;
  }
  try {
    const encoded = JSON.stringify(input);
    if (!encoded) {
      return null;
    }
    if (encoded.length <= MAX_TOOL_INPUT_CHARS) {
      return encoded;
    }
    return `${encoded.slice(0, MAX_TOOL_INPUT_CHARS)}...`;
  } catch {
    return null;
  }
}

function formatToolSummary(summary: string | undefined): string | null {
  if (typeof summary !== "string") {
    return null;
  }
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= MAX_TOOL_SUMMARY_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TOOL_SUMMARY_CHARS - 3)}...`;
}

function inputFromUnknownDetail(
  detail: Extract<AgentTimelineItem, { type: "tool_call" }>["detail"],
): unknown {
  return detail.type === "unknown" ? detail.input : null;
}

function projectForCuration(items: readonly AgentTimelineItem[]): AgentTimelineItem[] {
  const rows = items.map((item, index) => ({
    seq: index + 1,
    timestamp: "",
    item,
  }));
  return projectTimelineRows({ rows, mode: "projected" }).map((entry) => entry.item);
}

function shouldIncludeItem(item: AgentTimelineItem, options?: ActivityCuratorOptions): boolean {
  if (!options?.includeKinds) {
    return true;
  }
  return options.includeKinds.includes(item.type);
}

function formatToolCallEntry(
  item: Extract<AgentTimelineItem, { type: "tool_call" }>,
  options?: ActivityCuratorOptions,
): ActivityEntry {
  const inputJson = formatToolInputJson(inputFromUnknownDetail(item.detail));
  const display = buildToolCallDisplayModel({
    name: item.name,
    status: item.status,
    error: item.error,
    detail: item.detail,
    metadata: item.metadata,
  });
  const displayName = display.displayName;
  const summary = formatToolSummary(display.summary);
  if (
    (options?.includeExternalToolInput ?? true) &&
    isLikelyExternalToolName(item.name) &&
    inputJson
  ) {
    return activityEntry(`[${displayName}] ${inputJson}`);
  }
  return activityEntry(summary ? `[${displayName}] ${summary}` : `[${displayName}]`);
}

function curateProjectedActivityEntries(
  items: readonly AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): ActivityEntry[] {
  if (items.length === 0) {
    return [];
  }

  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
  const recentItems = maxItems > 0 && items.length > maxItems ? items.slice(-maxItems) : items;

  const entries: ActivityEntry[] = [];
  const buffers = { message: "", thought: "" };

  for (const item of recentItems) {
    if (!shouldIncludeItem(item, options)) {
      continue;
    }

    switch (item.type) {
      case "user_message":
        flushBuffers(entries, buffers, options);
        entries.push(activityEntry(`[User] ${item.text.trim()}`));
        break;
      case "assistant_message":
        buffers.message = appendText(buffers.message, item.text);
        break;
      case "reasoning":
        buffers.thought = appendText(buffers.thought, item.text);
        break;
      case "tool_call": {
        flushBuffers(entries, buffers, options);
        entries.push(formatToolCallEntry(item, options));
        if (item.detail.type === "sub_agent" && item.detail.log.trim()) {
          entries.push(activityEntry(item.detail.log.trim()));
        }
        break;
      }
      case "todo":
        flushBuffers(entries, buffers, options);
        entries.push(activityEntry("[Tasks]"));
        for (const entry of item.items) {
          const checkbox = entry.completed ? "[x]" : "[ ]";
          const text = `- ${checkbox} ${entry.text}`;
          entries.push(activityEntry(text));
        }
        break;
      case "error":
        flushBuffers(entries, buffers, options);
        entries.push(activityEntry(`[Error] ${item.message}`));
        break;
      case "compaction":
        flushBuffers(entries, buffers, options);
        entries.push(activityEntry("[Compacted]"));
        break;
    }
  }

  flushBuffers(entries, buffers, options);

  return entries;
}

function curateAgentActivityEntries(
  timeline: AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): ActivityEntry[] {
  const collapsed = projectForCuration(timeline);
  return curateProjectedActivityEntries(collapsed, options);
}

/**
 * Convert normalized agent timeline items into a concise text summary.
 */
export function curateAgentActivity(
  timeline: AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): string {
  const entries = curateAgentActivityEntries(timeline, options);
  return entries.length > 0
    ? entries.map((entry) => entry.text).join("\n")
    : "No activity to display.";
}

interface ForkCursorBoundary {
  timelineEpoch: string;
  cursor: { epoch: string; seq: number };
}

function selectForkContextRows(input: {
  rows: readonly AgentTimelineRow[];
  cursorBoundary?: ForkCursorBoundary | null;
  boundaryMessageId?: string | null;
}): {
  items: AgentTimelineItem[];
  boundaryCursor: { epoch: string; seq: number } | null;
  boundaryMessageId: string | null;
} {
  const projectedRows = projectTimelineRows({ rows: input.rows, mode: "projected" });
  const boundaryCursor = input.cursorBoundary?.cursor ?? null;
  const boundaryMessageId = input.boundaryMessageId?.trim() || null;
  if (!boundaryCursor && !boundaryMessageId) {
    return {
      items: projectedRows.map((entry) => entry.item),
      boundaryCursor: null,
      boundaryMessageId: null,
    };
  }

  if (
    input.cursorBoundary &&
    input.cursorBoundary.cursor.epoch !== input.cursorBoundary.timelineEpoch
  ) {
    throw new Error("Selected timeline position is no longer available.");
  }
  const boundaryIndex = findForkBoundaryIndex({ projectedRows, boundaryCursor, boundaryMessageId });
  const boundarySeq = resolveForkBoundarySeq(projectedRows, boundaryIndex);
  const projected = projectedRows.filter((row) => row.seqEnd <= boundarySeq);

  return {
    items: projected.map((entry) => entry.item),
    boundaryCursor,
    boundaryMessageId,
  };
}

function findForkBoundaryIndex(input: {
  projectedRows: readonly TimelineProjectionEntry[];
  boundaryCursor: { epoch: string; seq: number } | null;
  boundaryMessageId: string | null;
}): number {
  const { projectedRows, boundaryCursor, boundaryMessageId } = input;
  const boundaryIndex = boundaryCursor
    ? projectedRows.findIndex((row) => row.seqEnd === boundaryCursor.seq)
    : projectedRows.findLastIndex(
        (row) => row.item.type === "assistant_message" && row.item.messageId === boundaryMessageId,
      );
  if (boundaryIndex < 0) {
    throw new Error(
      boundaryCursor
        ? "Selected timeline position is no longer available."
        : "Selected assistant message is no longer available.",
    );
  }
  return boundaryIndex;
}

function resolveForkBoundarySeq(
  projectedRows: readonly TimelineProjectionEntry[],
  index: number,
): number {
  const boundarySeq = projectedRows[index].seqEnd;
  if (projectedRows.some((row) => row.seqStart <= boundarySeq && row.seqEnd > boundarySeq)) {
    throw new Error(
      "This checkpoint changed after it was created. Fork from a later completed response instead.",
    );
  }
  return boundarySeq;
}

/**
 * Finds the first user message after the forked assistant message. A native
 * fork copies the provider session up to that message; `undefined` means the
 * fork keeps everything.
 */
export function selectNativeForkNextUserRow(input: {
  rows: readonly AgentTimelineRow[];
  cursorBoundary?: ForkCursorBoundary | null;
  boundaryMessageId?: string | null;
}): AgentTimelineRow | undefined {
  const projectedRows = projectTimelineRows({ rows: input.rows, mode: "projected" });
  if (
    input.cursorBoundary &&
    input.cursorBoundary.cursor.epoch !== input.cursorBoundary.timelineEpoch
  ) {
    throw new Error("Selected timeline position is no longer available.");
  }
  const boundaryIndex = findForkBoundaryIndex({
    projectedRows,
    boundaryCursor: input.cursorBoundary?.cursor ?? null,
    boundaryMessageId: input.boundaryMessageId?.trim() || null,
  });
  const boundarySeq = resolveForkBoundarySeq(projectedRows, boundaryIndex);
  return input.rows.find((row) => row.seq > boundarySeq && row.item.type === "user_message");
}

const CHAT_HISTORY_SUMMARY_OPEN = "<chat-history-summary>";
const CHAT_HISTORY_SUMMARY_CLOSE = "</chat-history-summary>";
const CHAT_HISTORY_SUMMARY_PATTERN = new RegExp(
  `${CHAT_HISTORY_SUMMARY_OPEN}[\\s\\S]*?${CHAT_HISTORY_SUMMARY_CLOSE}\\s*`,
  "g",
);

/**
 * Removes a summary fork's chat history from a user message. Live prompts never
 * show it, but providers store it in the prompt text, so rebuilt history would.
 */
export function stripChatHistorySummary(text: string): string {
  return text.includes(CHAT_HISTORY_SUMMARY_OPEN)
    ? text.replace(CHAT_HISTORY_SUMMARY_PATTERN, "").trim()
    : text;
}

function trimContextMetadata(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildForkContextText(input: {
  body: string;
  agentTitle?: string | null;
  cwd?: string | null;
}): string {
  const header = ["Chat history from a previous Paseo agent."];
  const agentTitle = trimContextMetadata(input.agentTitle);
  const cwd = trimContextMetadata(input.cwd);
  if (agentTitle) {
    header.push(`Source agent: ${agentTitle}`);
  }
  if (cwd) {
    header.push(`Source directory: ${cwd}`);
  }
  return `${CHAT_HISTORY_SUMMARY_OPEN}\n${header.join("\n")}\n\n${input.body}\n${CHAT_HISTORY_SUMMARY_CLOSE}`;
}

export function buildAgentForkContextAttachment(input: {
  agentId: string;
  rows: readonly AgentTimelineRow[];
  cursorBoundary?: ForkCursorBoundary | null;
  boundaryMessageId?: string | null;
  agentTitle?: string | null;
  cwd?: string | null;
}): {
  attachment: TextAgentAttachment;
  itemCount: number;
  boundaryCursor: { epoch: string; seq: number } | null;
  boundaryMessageId: string | null;
} {
  const selected = selectForkContextRows({
    rows: input.rows,
    cursorBoundary: input.cursorBoundary,
    boundaryMessageId: input.boundaryMessageId,
  });
  const entries = curateProjectedActivityEntries(selected.items, {
    maxItems: 0,
    labelAssistantMessages: true,
    includeKinds: ["user_message", "assistant_message", "tool_call"],
    includeExternalToolInput: false,
  });
  const body =
    entries.length > 0
      ? entries.map((entry) => entry.text).join("\n")
      : "No chat history to display.";
  return {
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Chat history",
      text: buildForkContextText({
        body,
        agentTitle: input.agentTitle,
        cwd: input.cwd,
      }),
      sourceAgentId: input.agentId,
    },
    itemCount: selected.items.length,
    boundaryCursor: selected.boundaryCursor,
    boundaryMessageId: selected.boundaryMessageId,
  };
}
