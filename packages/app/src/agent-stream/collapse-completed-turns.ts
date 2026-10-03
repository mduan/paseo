import { createContext, useCallback, useContext, useMemo, useReducer } from "react";
import type { StreamItem } from "@/types/stream";
import { getStreamItemMessageId } from "./presentation";
import { continuesTurn, startsNewTurn } from "./turn-membership";

export interface WorkToggle {
  turnKey: string;
  expanded: boolean;
}

export interface FoldedTail {
  items: StreamItem[];
  /** The "Show work" toggle of each folded turn, keyed by the row it renders above. */
  toggles: ReadonlyMap<string, WorkToggle>;
}

/**
 * The "Collapse completed turns" customization. In each finished turn, the work before the
 * final assistant message (tools, thoughts, earlier messages) folds behind a toggle. User
 * messages stay visible, so steers sent mid-turn still read in place. The live turn never folds.
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
    const finalStart = finalMessage
      ? turn.findIndex(
          (item) => getStreamItemMessageId(item) === getStreamItemMessageId(finalMessage),
        )
      : turn.length - 1;
    const isVisibleWhenFolded = (item: StreamItem, index: number) =>
      index >= finalStart || item.kind === "user_message";
    const firstWorkIndex = turn.findIndex((item, index) => !isVisibleWhenFolded(item, index));
    if (isLive || firstWorkIndex < 0) {
      items.push(...turn);
      return;
    }

    const turnKey = first.turnId ?? first.id;
    const expanded = expandedTurnKeys.has(turnKey);
    const visible = expanded ? turn : turn.filter(isVisibleWhenFolded);
    // The toggle stays where the work starts, so expanding reveals the work below it.
    const anchor = expanded
      ? turn[firstWorkIndex]!
      : turn.find((item, index) => index > firstWorkIndex && isVisibleWhenFolded(item, index))!;
    toggles.set(anchor.id, { turnKey, expanded });
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

/** Folds `tail` when enabled, with in-memory expanded turns per chat. */
export function useFoldedTail(input: {
  enabled: boolean;
  chatKey: string;
  tail: StreamItem[];
  head: StreamItem[];
  isTurnActive: boolean;
  activeTurnId: string | null;
  onBeforeToggle: () => void;
}): { tail: StreamItem[]; workToggles: WorkToggleContextValue | undefined } {
  const { enabled, chatKey, tail, head, isTurnActive, activeTurnId, onBeforeToggle } = input;
  const [expandedTurnKeys, toggleTurnKey] = useExpandedTurnKeys(chatKey);
  const onToggle = useCallback(
    (turnKey: string) => {
      onBeforeToggle();
      toggleTurnKey(turnKey);
    },
    [onBeforeToggle, toggleTurnKey],
  );
  return useMemo(() => {
    if (!enabled) return { tail, workToggles: undefined };
    const folded = foldCompletedTurns({ tail, head, isTurnActive, activeTurnId, expandedTurnKeys });
    return { tail: folded.items, workToggles: { toggles: folded.toggles, onToggle } };
  }, [enabled, tail, head, isTurnActive, activeTurnId, expandedTurnKeys, onToggle]);
}

export interface WorkToggleContextValue {
  toggles: ReadonlyMap<string, WorkToggle>;
  onToggle: (turnKey: string) => void;
}

/** Rows read their toggle from context, so memoized history rows update when it changes. */
export const WorkToggleContext = createContext<WorkToggleContextValue | undefined>(undefined);

export function useWorkToggle(itemId: string) {
  const value = useContext(WorkToggleContext);
  const toggle = value?.toggles.get(itemId);
  return toggle && value ? { ...toggle, onToggle: value.onToggle } : undefined;
}
