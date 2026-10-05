export interface ProviderSubagentCostNode {
  id: string;
  parentSubagentId: string | null;
  ownCostUsd: number;
}

export interface ProviderSubagentCost {
  ownCostUsd: number;
  subagentCostUsd: number;
  totalCostUsd: number;
}

export interface ProviderSubagentCostRollup {
  byId: Map<string, ProviderSubagentCost>;
  totalCostUsd: number;
}

/** Roll each direct cost into every native ancestor. Missing parents remain attributed to root. */
export function rollupProviderSubagentCosts(
  nodes: readonly ProviderSubagentCostNode[],
): ProviderSubagentCostRollup {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const byId = new Map(
    nodes.map((node) => [
      node.id,
      { ownCostUsd: node.ownCostUsd, subagentCostUsd: 0, totalCostUsd: node.ownCostUsd },
    ]),
  );

  let totalCostUsd = 0;
  for (const node of nodes) {
    totalCostUsd += node.ownCostUsd;
    const visited = new Set([node.id]);
    let parentId = node.parentSubagentId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parentCost = byId.get(parentId);
      if (!parentCost) break;
      parentCost.subagentCostUsd += node.ownCostUsd;
      parentCost.totalCostUsd += node.ownCostUsd;
      parentId = nodesById.get(parentId)?.parentSubagentId ?? null;
    }
  }

  return { byId, totalCostUsd };
}
