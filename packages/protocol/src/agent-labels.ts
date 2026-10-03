export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
const OPEN_AGENT_TAB_LABEL_PREFIX = "paseo.open-agent-tab.";

export function getOpenAgentTabLabel(clientId: string): string {
  return `${OPEN_AGENT_TAB_LABEL_PREFIX}${clientId}`;
}

export function isOpenAgentTabLabel(label: string): boolean {
  return label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX);
}

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

export function hasOpenAgentTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => isOpenAgentTabLabel(label) && value === "true",
  );
}

export const FORKED_FROM_AGENT_ID_LABEL = "paseo.forked-from-agent-id";
export const FORK_MODE_LABEL = "paseo.fork-mode";
// Number of user messages the fork copied from its source. The fork marker goes
// right before the next user message, so it survives timeline rebuilds.
export const FORK_USER_MESSAGE_COUNT_LABEL = "paseo.fork-user-message-count";

export enum AgentForkMode {
  Full = "full",
  Summary = "summary",
}

export interface AgentForkOrigin {
  sourceAgentId: string;
  mode: AgentForkMode;
  userMessageCount: number;
}

export function buildAgentForkLabels(origin: AgentForkOrigin): Record<string, string> {
  return {
    [FORKED_FROM_AGENT_ID_LABEL]: origin.sourceAgentId,
    [FORK_MODE_LABEL]: origin.mode,
    [FORK_USER_MESSAGE_COUNT_LABEL]: String(origin.userMessageCount),
  };
}

export function getAgentForkOriginFromLabels(
  labels: Record<string, unknown> | null | undefined,
): AgentForkOrigin | undefined {
  const sourceAgentId = labels?.[FORKED_FROM_AGENT_ID_LABEL];
  const mode = labels?.[FORK_MODE_LABEL];
  const userMessageCount = Number(labels?.[FORK_USER_MESSAGE_COUNT_LABEL]);
  if (
    typeof sourceAgentId !== "string" ||
    !sourceAgentId ||
    (mode !== AgentForkMode.Full && mode !== AgentForkMode.Summary) ||
    !Number.isInteger(userMessageCount) ||
    userMessageCount < 0
  ) {
    return undefined;
  }
  return { sourceAgentId, mode, userMessageCount };
}
