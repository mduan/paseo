import type { AgentUsage } from "@getpaseo/protocol/agent-types";
import { formatSubagentTokens } from "@getpaseo/protocol/subagent-format";
import { formatSessionCost } from "@/components/agent-cost";
import { resolveAgentModelSelection } from "@/composer/agent-controls/utils";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { useSessionStore } from "@/stores/session-store";

export interface AgentMetaParts {
  model?: string;
  effort?: string;
  tokens?: string;
  cost?: string;
}

type AgentModelSelection = Pick<
  ReturnType<typeof resolveAgentModelSelection>,
  "activeModelId" | "displayModel" | "selectedThinkingId" | "displayThinking"
>;

/**
 * Session cost including Paseo children, prefixed "~" when Paseo priced any of it from token
 * counts.
 */
function formatAgentCost(usage: AgentUsage | null | undefined): string | undefined {
  if (typeof usage?.totalCostUsd !== "number" && typeof usage?.paseoSubagentCostUsd !== "number") {
    return undefined;
  }
  const total = formatSessionCost((usage.totalCostUsd ?? 0) + (usage.paseoSubagentCostUsd ?? 0));
  if (!total) return undefined;
  return usage.totalCostEstimated || usage.paseoSubagentCostEstimated ? `~${total}` : total;
}

/** Model, effort, tokens, and cost; each part is undefined when the agent doesn't report it. */
export function buildAgentMetaParts({
  selection,
  usage,
}: {
  selection: AgentModelSelection;
  usage: AgentUsage | null | undefined;
}): AgentMetaParts {
  return {
    model: selection.activeModelId ? selection.displayModel : undefined,
    effort: selection.selectedThinkingId ? selection.displayThinking : undefined,
    tokens: formatSubagentTokens(usage?.contextWindowUsedTokens),
    cost: formatAgentCost(usage),
  };
}

export function useAgentMetaParts({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}): AgentMetaParts {
  const agent = useSessionStore((state) => state.sessions[serverId]?.agents?.get(agentId));
  const { entries } = useProvidersSnapshot(serverId, { cwd: agent?.cwd });
  const models = entries?.find((entry) => entry.provider === agent?.provider)?.models ?? null;
  const selection = resolveAgentModelSelection({
    models: filterSelectableModels(models),
    runtimeModelId: agent?.runtimeInfo?.model,
    configuredModelId: agent?.model,
    runtimeThinkingOptionId: agent?.runtimeInfo?.thinkingOptionId,
    explicitThinkingOptionId: agent?.thinkingOptionId,
  });
  return buildAgentMetaParts({ selection, usage: agent?.lastUsage });
}
