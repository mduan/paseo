import type { AgentTurnDiffPayload, DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentTurnDiffTarget } from "@getpaseo/protocol/messages";

export function agentTurnDiffQueryOptions(input: {
  serverId: string;
  agentId: string | null;
  target: AgentTurnDiffTarget;
  ignoreWhitespace: boolean;
  latestTurnDiffAt: string | null;
  client: Pick<DaemonClient, "getAgentTurnDiff"> | null;
  enabled: boolean;
}) {
  const { agentId, client, target, ignoreWhitespace } = input;
  return {
    queryKey: [
      "agent-turn-diff",
      input.serverId,
      agentId,
      target,
      ignoreWhitespace,
      // A completed turn's trees never change when another turn finishes.
      target.kind === "turn" ? null : input.latestTurnDiffAt,
    ],
    queryFn: () => {
      if (!client || !agentId) throw new Error("Host disconnected");
      return client.getAgentTurnDiff({ agentId, target, ignoreWhitespace });
    },
    enabled: input.enabled && Boolean(client) && Boolean(agentId),
    dataShape: "value" as const,
    immutableWhen: (data: AgentTurnDiffPayload) => data.available && !data.error,
  };
}
