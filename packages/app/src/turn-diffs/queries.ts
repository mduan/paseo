import type { AgentTurnDiffTarget, TurnDiffSummary } from "@getpaseo/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { useSettings } from "@/hooks/use-settings";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { agentTurnDiffQueryOptions } from "./query-options";

const EMPTY_TURNS: TurnDiffSummary[] = [];

/** Turn diffs show when the host records them and the "Turn diffs" customization is on. */
export function useTurnDiffsEnabled(serverId: string): boolean {
  const supported = useHostFeature(serverId, "turnDiffs");
  const enabled = useSettings((settings) => settings.turnDiffs);
  return supported && enabled;
}

function useLatestTurnDiffAt(serverId: string, agentId: string | null): string | null {
  return useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.agents.get(agentId)?.latestTurnDiffAt ?? null) : null,
  );
}

export function useAgentTurnDiffs(input: {
  serverId: string;
  agentId: string;
  enabled: boolean;
  prefetchLatest?: boolean;
}): TurnDiffSummary[] {
  const client = useHostRuntimeClient(input.serverId);
  const { preferences, isLoading: preferencesLoading } = useChangesPreferences();
  const latestTurnDiffAt = useLatestTurnDiffAt(input.serverId, input.agentId);
  const query = useFetchQuery({
    queryKey: ["agent-turn-diffs", input.serverId, input.agentId, latestTurnDiffAt],
    queryFn: () => {
      if (!client) throw new Error("Host disconnected");
      return client.listAgentTurnDiffs(input.agentId);
    },
    enabled: input.enabled && Boolean(client),
    dataShape: "list",
    immutableWhen: () => true,
  });
  const latestTurnId = query.data?.at(-1)?.turnId;
  const prefetchEnabled = Boolean(input.enabled && input.prefetchLatest && latestTurnId);
  useFetchQuery(
    agentTurnDiffQueryOptions({
      serverId: input.serverId,
      agentId: input.agentId,
      target: { kind: "turn", turnId: latestTurnId ?? "" },
      ignoreWhitespace: preferences.hideWhitespace,
      latestTurnDiffAt: null,
      client,
      enabled: prefetchEnabled && !preferencesLoading,
    }),
  );
  return query.data ?? EMPTY_TURNS;
}

export function useAgentTurnDiff(input: {
  serverId: string;
  agentId: string | null;
  target: AgentTurnDiffTarget;
  ignoreWhitespace: boolean;
  enabled: boolean;
}) {
  const client = useHostRuntimeClient(input.serverId);
  const latestTurnDiffAt = useLatestTurnDiffAt(input.serverId, input.agentId);
  return useFetchQuery(agentTurnDiffQueryOptions({ ...input, client, latestTurnDiffAt }));
}
