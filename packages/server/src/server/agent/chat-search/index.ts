import { createPhrasePattern } from "@getpaseo/protocol/search/phrase";
import type { SearchOptions } from "@getpaseo/protocol/search/options";
import { completedTurnFolds } from "@getpaseo/protocol/turns";
import MarkdownIt from "markdown-it";
import { setImmediate } from "node:timers/promises";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { projectTimelineRows } from "../timeline-projection.js";

const markdown = new MarkdownIt({ html: false });
const PAGE_SIZE = 200;
interface SearchLocation {
  seq: number;
  role: "user" | "assistant";
  count: number;
  folded: boolean;
  turnId?: string;
}
interface SearchInput {
  rows: readonly AgentTimelineRow[];
  query: string;
  cursor?: number;
  options?: SearchOptions;
  isRunning?: boolean;
}

// Discovery is deliberately approximate. Only the client can verify displayed text, so
// `count` estimates rendered occurrences and the client replaces it with the rendered
// count once the message is on screen. Blocks are counted separately, and the Markdown
// source is never searched whole, because a match the client cannot highlight — across
// a block boundary, or on syntax the reader never sees — still inflates the total until
// navigation reaches that message and drops it.
function searchableBlocks(text: string): string[] {
  return markdown
    .parse(text, {})
    .map((token) => {
      if (token.type === "inline") {
        return (token.children ?? [])
          .map((child) => {
            if (child.type === "text" || child.type === "code_inline") return child.content;
            if (child.type === "softbreak" || child.type === "hardbreak") return "\n";
            return "";
          })
          .join("");
      }
      if (token.type === "fence" || token.type === "code_block") return token.content;
      return "";
    })
    .filter(Boolean);
}

function countMatches(text: string, pattern: RegExp): number {
  let count = 0;
  for (const match of text.matchAll(pattern)) {
    if (match[0].length) count += 1;
  }
  return count;
}

export async function searchTimeline({
  rows,
  query,
  cursor = 0,
  options,
  isRunning = false,
}: SearchInput) {
  const locations: SearchLocation[] = [];
  if (!query.trim()) return { locations, nextCursor: null };
  const pattern = createPhrasePattern({ query, options });
  const entries = projectTimelineRows({ rows, mode: "projected" });
  const foldItems = entries.map((entry) => ({
    entry,
    kind: entry.item.type,
    turnId: entry.turnId,
    text: entry.item.type === "assistant_message" ? entry.item.text : undefined,
  }));
  const folds = completedTurnFolds({
    items: foldItems,
    getMessageId: ({ entry }) => String(entry.seqEnd),
    lastTurnIsLive: isRunning,
  });
  const foldedEntries = new Set(
    folds.flatMap((turn) => [...turn.folded].map(({ entry }) => entry)),
  );

  let lastYield = performance.now();
  for (const entry of entries) {
    if (entry.seqEnd <= cursor) continue;
    const item = entry.item;
    if (item.type !== "user_message" && item.type !== "assistant_message") continue;
    const raw = item.text.replace(/\r/g, "");
    const blocks = item.type === "assistant_message" ? searchableBlocks(raw) : [raw];
    const count = blocks.reduce((sum, block) => sum + countMatches(block, pattern), 0);
    if (count) {
      if (locations.length === PAGE_SIZE) {
        return { locations, nextCursor: locations[PAGE_SIZE - 1]!.seq };
      }
      locations.push({
        seq: entry.seqEnd,
        role: item.type === "user_message" ? "user" : "assistant",
        count,
        folded: foldedEntries.has(entry),
        turnId: entry.turnId,
      });
    }
    if (performance.now() - lastYield >= 8) {
      await setImmediate();
      lastYield = performance.now();
    }
  }
  return { locations, nextCursor: null };
}
