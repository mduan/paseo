/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
export type TurnItem = {
  kind: string;
  turnId?: string;
  text?: string;
};

export function continuesTurn(previous: TurnItem | null, next: TurnItem | null): boolean {
  if (!previous || !next) return false;
  if (previous.turnId !== undefined && next.turnId !== undefined) {
    return previous.turnId === next.turnId;
  }
  if (previous.kind === "fork_marker") return true;
  return next.kind !== "user_message" && next.kind !== "fork_marker";
}

type FoldedTurn<T> = {
  items: T[];
  finalStart: number | null;
  folded: ReadonlySet<T>;
};

// Codex's leading rule belongs to the earlier work, even when it shares the final message ID.
const RULE_BLOCK = /^\s*---\s*$/;

export function completedTurnFolds<T extends TurnItem>({
  items,
  getMessageId,
  lastTurnIsLive = false,
  activeTurnId,
}: {
  items: readonly T[];
  getMessageId(item: T): string;
  lastTurnIsLive?: boolean;
  activeTurnId?: string;
}): FoldedTurn<T>[] {
  const turns: T[][] = [];
  items.forEach((item, index) => {
    if (!continuesTurn(items[index - 1] ?? null, item)) turns.push([]);
    turns[turns.length - 1]!.push(item);
  });
  return turns.map((turn, turnIndex) => {
    const isLive =
      (activeTurnId !== undefined && turn[0]!.turnId === activeTurnId) ||
      (lastTurnIsLive && turnIndex === turns.length - 1);
    const finalMessage = turn.findLast((item) => item.kind === "assistant_message");
    const folded = new Set<T>();
    if (isLive || !finalMessage) return { items: turn, finalStart: null, folded };
    const finalStart = turn.findIndex((item) => getMessageId(item) === getMessageId(finalMessage));
    turn.forEach((item, index) => {
      if (item.kind === "user_message" || item.kind === "fork_marker") return;
      const leadingRule =
        index === finalStart &&
        item.kind === "assistant_message" &&
        RULE_BLOCK.test(item.text ?? "");
      if (index < finalStart || leadingRule) folded.add(item);
    });
    return { items: turn, finalStart, folded };
  });
}
