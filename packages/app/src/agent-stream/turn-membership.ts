import type { StreamItem } from "@/types/stream";

import { continuesTurn } from "@getpaseo/protocol/turns";
export { continuesTurn } from "@getpaseo/protocol/turns";

function opensTurn(item: StreamItem): boolean {
  return item.kind === "user_message" || item.kind === "fork_marker";
}

/**
 * A visible response can span multiple canonical turns when their prompts are
 * system-injected and therefore absent from the Paseo timeline.
 */
export function continuesResponse(previous: StreamItem | null, next: StreamItem | null): boolean {
  if (!previous || !next) return false;
  return continuesTurn(previous, next) || !opensTurn(next);
}

export function isTurnBoundary(previous: StreamItem | null, next: StreamItem | null): boolean {
  return previous !== null && next !== null && !continuesTurn(previous, next);
}

/** Whether `item` begins a new chronological turn after `previous`. */
export function startsNewTurn(item: StreamItem, previous: StreamItem | null): boolean {
  return previous === null || isTurnBoundary(previous, item);
}

export function belongsToTurn(item: StreamItem, turnId: string | null): boolean {
  return turnId !== null && item.turnId === turnId;
}
