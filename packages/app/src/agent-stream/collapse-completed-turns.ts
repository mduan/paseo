import { createContext, useCallback, useContext, useMemo, useReducer } from "react";
import type { StreamItem } from "@/types/stream";
import { getStreamItemMessageId } from "./presentation";
import { continuesTurn, startsNewTurn } from "./turn-membership";

export interface WorkToggle {
  turnKey: string;
  expanded: boolean;
  /** False when the turn has no work to fold; the row then only shows the duration. */
  hasWork: boolean;
  /**
   * From the turn's prompt, or a hidden-prompt turn's first row, to its last row; null when the
   * turn's start is not loaded.
   */
  durationMs: number | null;
}

export interface FoldedTail {
  items: StreamItem[];
  /** The "Worked for" row of each completed turn, keyed by the row it renders above. */
  toggles: ReadonlyMap<string, WorkToggle>;
}

// Codex separates consecutive assistant messages with a leading rule (see
// ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN in the codex provider), which renders as its own block
// row. It folds with the earlier messages so it never sits under the toggle's own line.
const RULE_BLOCK = /^\s*---\s*$/;

/**
 * In each finished turn, the work before the final assistant message (tools, thoughts,
 * earlier messages) folds behind a "Worked for" toggle. User messages and fork markers stay
 * visible, so steers sent mid-turn still read in place. The live turn never folds.
 */
export function foldCompletedTurns(input: {
  tail: StreamItem[];
  head: StreamItem[];
  isTurnActive: boolean;
  activeTurnId: string | null;
  expandedTurnKeys: ReadonlySet<string>;
}): FoldedTail {
  const { tail, head, isTurnActive, activeTurnId, expandedTurnKeys } = input;
  const turns: StreamItem[][] = [];
  tail.forEach((item, index) => {
    if (startsNewTurn(item, tail[index - 1] ?? null)) turns.push([]);
    turns[turns.length - 1]!.push(item);
  });
  const lastTurnIsLive =
    (isTurnActive && activeTurnId === null) ||
    (head.length > 0 && continuesTurn(tail[tail.length - 1] ?? null, head[0]!));

  const items: StreamItem[] = [];
  const toggles = new Map<string, WorkToggle>();
  turns.forEach((turn, turnIndex) => {
    const first = turn[0]!;
    const isLive =
      (isTurnActive && activeTurnId !== null && first.turnId === activeTurnId) ||
      (lastTurnIsLive && turnIndex === turns.length - 1);
    const finalMessage = turn.findLast((item) => item.kind === "assistant_message");
    if (isLive || !finalMessage) {
      items.push(...turn);
      return;
    }
    const finalStart = turn.findIndex(
      (item) => getStreamItemMessageId(item) === getStreamItemMessageId(finalMessage),
    );
    const isVisibleWhenFolded = (item: StreamItem, index: number) =>
      (index >= finalStart &&
        !(
          index === finalStart &&
          item.kind === "assistant_message" &&
          RULE_BLOCK.test(item.text)
        )) ||
      item.kind === "user_message" ||
      item.kind === "fork_marker";
    const firstWorkIndex = turn.findIndex((item, index) => !isVisibleWhenFolded(item, index));
    // A turn without a prompt below another turn was started by a hidden system prompt, so it
    // starts at its first row. The first loaded turn may instead be cut off by history paging.
    const startedAt =
      turn.find((item) => item.kind === "user_message")?.timestamp ??
      (turnIndex > 0 ? first.timestamp : null);
    const durationMs = startedAt
      ? Math.max(0, turn[turn.length - 1]!.timestamp.getTime() - startedAt.getTime())
      : null;
    const turnKey = first.turnId ?? first.id;

    if (firstWorkIndex < 0) {
      if (durationMs !== null) {
        toggles.set(turn[finalStart]!.id, { turnKey, expanded: false, hasWork: false, durationMs });
      }
      items.push(...turn);
      return;
    }

    const expanded = expandedTurnKeys.has(turnKey);
    const visible = expanded ? turn : turn.filter(isVisibleWhenFolded);
    // The toggle stays where the work starts, so expanding reveals the work below it.
    const anchor = expanded
      ? turn[firstWorkIndex]!
      : turn.find((item, index) => index > firstWorkIndex && isVisibleWhenFolded(item, index))!;
    toggles.set(anchor.id, { turnKey, expanded, hasWork: true, durationMs });
    items.push(...visible);
  });
  // A subsequence of the same length is the tail itself; keep its identity for layout caches.
  return { items: items.length === tail.length ? tail : items, toggles };
}

const EMPTY_TURN_KEYS: ReadonlySet<string> = new Set();
// ponytail: module-level so expanded turns survive remounts until the app restarts; never pruned.
const expandedTurnKeysByChat = new Map<string, ReadonlySet<string>>();

function useExpandedTurnKeys(chatKey: string) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const toggle = useCallback(
    (turnKey: string) => {
      const next = new Set(expandedTurnKeysByChat.get(chatKey));
      if (!next.delete(turnKey)) next.add(turnKey);
      expandedTurnKeysByChat.set(chatKey, next);
      rerender();
    },
    [chatKey],
  );
  return [expandedTurnKeysByChat.get(chatKey) ?? EMPTY_TURN_KEYS, toggle] as const;
}

/** Folds `tail`, with in-memory expanded turns per chat. */
export function useFoldedTail(input: {
  chatKey: string;
  tail: StreamItem[];
  head: StreamItem[];
  isTurnActive: boolean;
  activeTurnId: string | null;
  onBeforeToggle: () => void;
}): { tail: StreamItem[]; workToggles: WorkToggleContextValue } {
  const { chatKey, tail, head, isTurnActive, activeTurnId, onBeforeToggle } = input;
  const [expandedTurnKeys, toggleTurnKey] = useExpandedTurnKeys(chatKey);
  const onToggle = useCallback(
    (turnKey: string) => {
      onBeforeToggle();
      toggleTurnKey(turnKey);
    },
    [onBeforeToggle, toggleTurnKey],
  );
  return useMemo(() => {
    const folded = foldCompletedTurns({ tail, head, isTurnActive, activeTurnId, expandedTurnKeys });
    return { tail: folded.items, workToggles: { toggles: folded.toggles, onToggle } };
  }, [tail, head, isTurnActive, activeTurnId, expandedTurnKeys, onToggle]);
}

export interface WorkToggleContextValue {
  toggles: ReadonlyMap<string, WorkToggle>;
  onToggle: (turnKey: string) => void;
}

/** Rows read their toggle from context, so memoized history rows update when it changes. */
export const WorkToggleContext = createContext<WorkToggleContextValue | undefined>(undefined);

export function useWorkToggle(itemId: string | undefined) {
  const value = useContext(WorkToggleContext);
  const toggle = itemId ? value?.toggles.get(itemId) : undefined;
  return toggle && value ? { ...toggle, onToggle: value.onToggle } : undefined;
}
