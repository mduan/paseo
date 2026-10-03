import type { TurnDiffSummary } from "@getpaseo/protocol/messages";
import type { StreamItem } from "@/types/stream";
import { startsNewTurn } from "@/agent-stream/turn-membership";

function userMessageIds(item: StreamItem): string[] {
  if (item.kind !== "user_message") return [];
  return [item.id, item.clientMessageId, item.messageId].filter((id): id is string => Boolean(id));
}

/**
 * Places each turn's diff card on the turn's last assistant message, where the turn footer sits.
 * Live rows carry the turn id; rows rebuilt after a daemon restart only match through the ids
 * of the turn's user message.
 */
export function anchorTurnDiffs(input: {
  tail: StreamItem[];
  turns: TurnDiffSummary[];
}): ReadonlyMap<string, TurnDiffSummary> {
  const anchors = new Map<string, TurnDiffSummary>();
  if (input.turns.length === 0) return anchors;
  const byTurnId = new Map(input.turns.map((turn) => [turn.turnId, turn]));
  const byMessageId = new Map(
    input.turns.flatMap((turn) => turn.userMessageIds.map((id) => [id, turn] as const)),
  );

  const findSummary = (item: StreamItem) => {
    const byTurn = item.turnId ? byTurnId.get(item.turnId) : undefined;
    return (
      byTurn ??
      userMessageIds(item)
        .map((id) => byMessageId.get(id))
        .find(Boolean)
    );
  };

  let turnItems: StreamItem[] = [];
  const flush = () => {
    const summary = turnItems.map(findSummary).find(Boolean);
    const anchor = turnItems.findLast((item) => item.kind === "assistant_message");
    if (summary && anchor) anchors.set(anchor.id, summary);
    turnItems = [];
  };
  input.tail.forEach((item, index) => {
    if (startsNewTurn(item, input.tail[index - 1] ?? null)) flush();
    turnItems.push(item);
  });
  flush();
  return anchors;
}
