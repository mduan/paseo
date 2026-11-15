import type { AgentModelDefinition } from "@getpaseo/protocol/agent-types";

export function findModelByReference(
  models: readonly AgentModelDefinition[] | null,
  modelId: string,
): AgentModelDefinition | null {
  if (!models || models.length === 0) return null;
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) return null;
  return (
    models.find((model) => model.id === normalizedModelId) ??
    models.find((model) => model.aliases?.includes(normalizedModelId)) ??
    null
  );
}

export function filterSelectableModels(
  models: AgentModelDefinition[] | null,
): AgentModelDefinition[] | null {
  return models?.filter((model) => model.isSelectable !== false) ?? null;
}

// COMPAT(antigravity-model-effort): added in v0.11.0-fork.45, remove after 2027-02-15.
export function resolveAntigravityModelAlias(
  models: readonly AgentModelDefinition[] | null,
  modelId: string,
) {
  const model = findModelByReference(models, modelId);
  if (model?.provider !== "antigravity" || !model.aliases?.includes(modelId)) return undefined;
  const effort = model.thinkingOptions?.find((option) => modelId === `${model.id}-${option.id}`);
  return effort ? { modelId: model.id, thinkingOptionId: effort.id } : undefined;
}
