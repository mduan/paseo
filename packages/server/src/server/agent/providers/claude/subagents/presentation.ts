import {
  formatSubagentCost,
  formatSubagentTokens,
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
}

/** Build the complete compact subtitle Claude exposes to provider-neutral clients. */
export function buildClaudeSubagentSubtitle(
  facts: ClaudeSubagentPresentationFacts,
): string | undefined {
  const parts = [
    readPart(facts.title),
    formatModel(facts.model),
    formatEffort(facts.effort),
    formatSubagentTokens(facts.usage?.totalTokens),
    formatSubagentCost(facts.costUsd),
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" · ") : undefined;
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

function formatEffort(effort: string | undefined): string | undefined {
  const normalized = readPart(effort);
  if (!normalized) return undefined;
  if (normalized === "xhigh") return "Extra High";
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
