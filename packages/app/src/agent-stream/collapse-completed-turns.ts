import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import type { StreamItem } from "@/types/stream";
import { getStreamItemMessageId } from "./presentation";
import { continuesTurn, completedTurnFolds } from "@getpaseo/protocol/turns";

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
  const lastTurnIsLive =
    (isTurnActive && activeTurnId === null) ||
    (head.length > 0 && continuesTurn(tail[tail.length - 1] ?? null, head[0]!));

  const items: StreamItem[] = [];
  const toggles = new Map<string, WorkToggle>();
  const turns = completedTurnFolds({
    items: tail,
    getMessageId: getStreamItemMessageId,
    lastTurnIsLive,
    activeTurnId: isTurnActive ? (activeTurnId ?? undefined) : undefined,
  });
  turns.forEach(({ items: turn, finalStart, folded }, turnIndex) => {
    const first = turn[0]!;
    if (finalStart === null) {
      items.push(...turn);
      return;
    }
    const isVisibleWhenFolded = (item: StreamItem) => !folded.has(item);
    const firstWorkIndex = turn.findIndex((item) => folded.has(item));
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
      : turn.find((item, index) => index > firstWorkIndex && isVisibleWhenFolded(item))!;
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
  const expand = useCallback(
    (turnKey: string) => {
      const previous = expandedTurnKeysByChat.get(chatKey);
      if (previous?.has(turnKey)) return;
      expandedTurnKeysByChat.set(chatKey, new Set([...(previous ?? []), turnKey]));
      rerender();
    },
    [chatKey],
  );
  return [expandedTurnKeysByChat.get(chatKey) ?? EMPTY_TURN_KEYS, toggle, expand] as const;
}

type WorkToggleTarget = Pick<WorkToggle, "turnKey"> & { top?: number };
type PendingWorkToggleAnchor = Required<WorkToggleTarget> & { restore: (delta: number) => void };

/** Folds `tail`, with in-memory expanded turns per chat. */
export function useFoldedTail(input: {
  chatKey: string;
  tail: StreamItem[];
  head: StreamItem[];
  isTurnActive: boolean;
  activeTurnId: string | null;
  onBeforeToggle: () => ((delta: number) => void) | undefined;
}): {
  tail: StreamItem[];
  workToggles: WorkToggleContextValue;
  expandedTurnKeys: ReadonlySet<string>;
  expand(turnKey: string): void;
} {
  const { chatKey, tail, head, isTurnActive, activeTurnId, onBeforeToggle } = input;
  const [expandedTurnKeys, toggleTurnKey, expand] = useExpandedTurnKeys(chatKey);
  const pendingAnchorRef = useRef<PendingWorkToggleAnchor | undefined>(undefined);
  const onToggle = useCallback(
    ({ turnKey, top }: WorkToggleTarget) => {
      const restore = onBeforeToggle();
      pendingAnchorRef.current =
        top !== undefined && restore ? { turnKey, top, restore } : undefined;
      toggleTurnKey(turnKey);
    },
    [onBeforeToggle, toggleTurnKey],
  );
  const onToggleLayout = useCallback(({ turnKey, top }: Required<WorkToggleTarget>) => {
    const anchor = pendingAnchorRef.current;
    if (!anchor || anchor.turnKey !== turnKey) return;
    pendingAnchorRef.current = undefined;
    anchor.restore(anchor.top - top);
  }, []);
  return useMemo(() => {
    const folded = foldCompletedTurns({ tail, head, isTurnActive, activeTurnId, expandedTurnKeys });
    return {
      tail: folded.items,
      expandedTurnKeys,
      expand,
      workToggles: { toggles: folded.toggles, onToggle, onToggleLayout },
    };
  }, [tail, head, isTurnActive, activeTurnId, expandedTurnKeys, onToggle, onToggleLayout, expand]);
}

export interface WorkToggleContextValue {
  toggles: ReadonlyMap<string, WorkToggle>;
  onToggle: (target: WorkToggleTarget) => void;
  onToggleLayout: (target: Required<WorkToggleTarget>) => void;
}

/** Rows read their toggle from context, so memoized history rows update when it changes. */
export const WorkToggleContext = createContext<WorkToggleContextValue | undefined>(undefined);

export function useWorkToggle(itemId: string | undefined) {
  const value = useContext(WorkToggleContext);
  const toggle = itemId ? value?.toggles.get(itemId) : undefined;
  return toggle && value
    ? { ...toggle, onToggle: value.onToggle, onToggleLayout: value.onToggleLayout }
    : undefined;
}
