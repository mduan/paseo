import { useCallback } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useMutation, useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ConversationTitleTarget,
  type ConversationTitleRequestMessage,
} from "@getpaseo/protocol/messages";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useToast } from "@/contexts/toast-context";

export function useAiRename(serverId: string | undefined, target: ConversationTitleTarget) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const supported = useHostFeature(serverId, "conversationTitleGeneration");
  const mutationKey = ["aiRename", serverId, target];
  const isPending = useIsMutating({ mutationKey }) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: async (id: string) => {
      if (!serverId) throw new Error(t("workspace.terminal.hostDisconnected"));
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      function readTitle(hostId: string) {
        const session = useSessionStore.getState().sessions[hostId];
        if (target === ConversationTitleTarget.Workspace) return session?.workspaces.get(id)?.title;
        const agent = session?.agents.get(id) ?? session?.agentDetails.get(id);
        return agent?.title;
      }
      const initialTitle = readTitle(serverId);
      const title = await client.generateConversationTitle({ target, id });
      if (readTitle(serverId) !== initialTitle)
        throw new Error(t("workspace.tabs.menu.renameWithAiChanged"));
      if (target === ConversationTitleTarget.Workspace) {
        await client.setWorkspaceTitle(id, title);
      } else {
        await client.updateAgent(id, { name: title });
        void queryClient.invalidateQueries({ queryKey: ["sidebarAgentsList", serverId] });
        void queryClient.invalidateQueries({ queryKey: ["allAgents", serverId] });
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const mutate = mutation.mutate;
  const rename = useCallback(
    (id: string) => {
      if (
        queryClient.isMutating({
          mutationKey: ["aiRename", serverId, target],
          predicate: (entry) => entry.state.variables === id,
        })
      )
        return;
      mutate(id);
    },
    [mutate, queryClient, serverId, target],
  );
  return { supported, rename, isPending };
}

type AiRenamePendingInput = Pick<ConversationTitleRequestMessage, "target"> & {
  serverId?: string;
  id?: string;
};

export function useAiRenamePending(input: AiRenamePendingInput) {
  return (
    useIsMutating({
      mutationKey: ["aiRename", input.serverId, input.target],
      predicate: (mutation) => mutation.state.variables === input.id,
    }) > 0
  );
}
