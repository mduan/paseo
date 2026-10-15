import { formatSubagentTokens } from "@getpaseo/protocol/subagent-format";
import {
  buildSubagentSubtitle,
  formatEffort,
  formatSubagentCosts,
  type ProviderSubagentSubtitle,
} from "../../../provider-subagents/subtitle-format.js";
import { findClaudeModel } from "../models.js";

export interface ClaudeSubagentUsage {
  totalTokens?: number;
}

export interface ClaudeSubagentPresentationFacts {
  title?: string;
  model?: string;
  effort?: string;
  usage?: ClaudeSubagentUsage;
  /** Estimated from list prices; Claude reports no cost per subagent. */
  costUsd?: number;
  /** Recursive cost of provider-native descendants, excluding this subagent. */
  subagentCostUsd?: number;
}

/** Build the complete compact subtitle Claude exposes to provider-neutral clients. */
export function buildClaudeSubagentSubtitle(
  facts: ClaudeSubagentPresentationFacts,
): ProviderSubagentSubtitle | undefined {
  return buildSubagentSubtitle({
    context: [readPart(facts.title), formatModel(facts.model), formatEffort(facts.effort)],
    usage: [
      formatSubagentTokens(facts.usage?.totalTokens),
      ...formatSubagentCosts({
        ownCostUsd: facts.costUsd,
        subagentCostUsd: facts.subagentCostUsd,
      }),
    ],
  });
}

function readPart(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatModel(modelId: string | undefined): string | undefined {
  const normalized = readPart(modelId);
  if (!normalized) return undefined;
  return findClaudeModel(normalized)?.label ?? normalized;
}
