/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
import type {
  AgentSnapshotPayload,
  LinearTicket,
  ProjectPlacementPayload,
} from "@getpaseo/protocol/messages";
import { createTextSearch } from "@getpaseo/protocol/search/query";
import type { SearchOptions } from "@getpaseo/protocol/search/options";

export type AgentHistorySearchCandidate = {
  agent: AgentSnapshotPayload;
  project: ProjectPlacementPayload;
  workspaceLinearTickets?: readonly LinearTicket[];
};

/** Search the names people recall, never an incomplete subset of transcripts. */
export function createAgentHistorySearch({
  query,
  options,
}: {
  query: string;
  options?: SearchOptions;
}) {
  const search = createTextSearch({ query, options });
  return ({ agent, project, workspaceLinearTickets }: AgentHistorySearchCandidate): boolean =>
    search.matches([
      project.workspaceName ?? "",
      agent.title ?? "",
      project.checkout.currentBranch ?? "",
      project.projectName,
      ...(workspaceLinearTickets ?? []).flatMap((ticket) => [
        ticket.identifier,
        ticket.title ?? "",
      ]),
    ]);
}
