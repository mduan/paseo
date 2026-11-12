import { ConversationTitleTarget } from "@getpaseo/protocol/messages";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { useProviderIcon } from "@/components/provider-icons";
import type { PanelDescriptor } from "@/panels/panel-registry";
import { selectAgentTurnPresentation, type Agent, useSessionStore } from "@/stores/session-store";
import { useSubagentsForParent } from "@/subagents";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { useAiRenamePending } from "@/workspace/ai-rename/use-ai-rename";

function formatProviderLabel(provider: Agent["provider"]): string {
  if (!provider) {
    return "Agent";
  }
  return provider
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveWorkspaceAgentTabLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}

export function useAgentPanelDescriptor(
  target: { kind: "agent"; agentId: string },
  context: { serverId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const subagents = useSubagentsForParent({
    serverId: context.serverId,
    parentAgentId: target.agentId,
    includeDescendants: true,
  });
  const descriptorState = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[context.serverId];
      const agent =
        session?.agents?.get(target.agentId) ?? session?.agentDetails?.get(target.agentId) ?? null;
      return {
        provider: agent?.provider ?? "codex",
        title: agent?.title ?? null,
        status: agent?.status ?? null,
        pendingPermissionCount: agent?.pendingPermissions.length ?? 0,
        requiresAttention: agent?.requiresAttention ?? false,
        attentionReason: agent?.attentionReason ?? null,
        isTurnActive: selectAgentTurnPresentation(session, target.agentId).isActive,
      };
    }),
  );
  const aiRenamePending = useAiRenamePending({
    serverId: context.serverId,
    target: ConversationTitleTarget.Agent,
    id: target.agentId,
  });
  const provider = descriptorState.provider;
  const label = aiRenamePending
    ? t("common.states.renaming")
    : resolveWorkspaceAgentTabLabel(descriptorState.title);
  const icon = useProviderIcon(provider, context.serverId);

  return {
    label: label ?? "",
    subtitle: `${formatProviderLabel(provider)} agent`,
    tooltip: label ?? `${formatProviderLabel(provider)} agent`,
    titleState: label ? "ready" : "loading",
    icon,
    statusBucket: descriptorState.status
      ? deriveSidebarStateBucket({
          status: descriptorState.isTurnActive ? "running" : descriptorState.status,
          pendingPermissionCount: descriptorState.pendingPermissionCount,
          requiresAttention: descriptorState.requiresAttention,
          attentionReason: descriptorState.attentionReason,
          hasRunningSubagents: subagents.some((row) => row.status === "running"),
        })
      : null,
  };
}
