import { parsePullRequestNumber } from "@getpaseo/protocol/pull-request";
import type { LinearTicket } from "@getpaseo/protocol/messages";
/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
import { normalizeForge, type Forge } from "@/git/forge";
import type { PresentableCheck } from "@/git/check-presentation";

export type PrHint = {
  linearTickets?: LinearTicket[];
  url: string;
  number: number;
  state: "open" | "merged" | "closed" | "draft";
  /** Forge backing this change request, so badges render the right brand mark. */
  forge: Forge;
  checks?: PrHintCheck[];
  checksStatus?: "none" | "pending" | "success" | "failure";
  reviewDecision?: "approved" | "changes_requested" | "pending" | null;
};

export interface PrHintCheck extends PresentableCheck {
  name: string;
  url: string | null;
}

interface PrStatusLike {
  linearTickets?: LinearTicket[];
  url: string;
  state: string;
  isMerged: boolean;
  isDraft?: boolean;
  checks?: PrHintCheck[];
  checksStatus?: string;
  reviewDecision?: string | null;
  forge?: string;
}

export function selectPrHintFromStatus(
  status: PrStatusLike | null | undefined,
  forge?: string | null,
): PrHint | null {
  if (!status?.url) {
    return null;
  }

  const number = parsePullRequestNumber(status.url);
  if (number === null) {
    return null;
  }

  let state: PrHint["state"];
  if (status.isMerged || status.state === "merged") state = "merged";
  else if (status.state === "open" && status.isDraft) state = "draft";
  else if (status.state === "open") state = "open";
  else state = "closed";

  return {
    linearTickets: status.linearTickets,
    url: status.url,
    number,
    state,
    forge: normalizeForge(forge ?? status.forge),
    checks: status.checks,
    checksStatus: status.checksStatus as PrHint["checksStatus"],
    reviewDecision: status.reviewDecision as PrHint["reviewDecision"],
  };
}
