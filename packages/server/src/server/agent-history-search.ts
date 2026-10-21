/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
import type {
  AgentSnapshotPayload,
  LinearTicket,
  ProjectPlacementPayload,
  WorkspacePullRequestSummary,
} from "@getpaseo/protocol/messages";
import { parsePullRequestNumber } from "@getpaseo/protocol/pull-request";
import { getForgeDefinitionOrNeutral } from "@getpaseo/protocol/forge-manifest";
import { createTextSearch } from "@getpaseo/protocol/search/query";
import type { SearchOptions } from "@getpaseo/protocol/search/options";

export type AgentHistorySearchCandidate = {
  agent: AgentSnapshotPayload;
  project: ProjectPlacementPayload;
  workspaceLinearTickets?: readonly LinearTicket[];
  workspacePullRequest?: WorkspacePullRequestSummary | null;
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
  return ({
    agent,
    project,
    workspaceLinearTickets,
    workspacePullRequest,
  }: AgentHistorySearchCandidate): boolean => {
    const number =
      workspacePullRequest?.number ??
      (workspacePullRequest ? parsePullRequestNumber(workspacePullRequest.url) : undefined);
    const prefix = getForgeDefinitionOrNeutral(
      workspacePullRequest?.forge ?? "github",
    ).changeRequestNumberPrefix;
    return search.matches([
      project.workspaceName ?? "",
      agent.title ?? "",
      project.checkout.currentBranch ?? "",
      project.projectName,
      ...(workspacePullRequest ? [workspacePullRequest.title, workspacePullRequest.url] : []),
      ...(number ? [String(number), `${prefix}${number}`] : []),
      ...(workspaceLinearTickets ?? []).flatMap((ticket) => [
        ticket.identifier,
        ticket.title ?? "",
      ]),
    ]);
  };
}
