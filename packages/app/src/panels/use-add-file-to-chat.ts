import { useCallback, useMemo } from "react";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import { resolveFocusedChatTarget, type FocusedChatTarget } from "@/composer/focused-chat-target";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

interface WorkspaceChatScope {
  serverId: string;
  workspaceId?: string | null;
}

function useWorkspaceKey(input: WorkspaceChatScope): string | null {
  return input.workspaceId
    ? buildWorkspaceTabPersistenceKey({ serverId: input.serverId, workspaceId: input.workspaceId })
    : null;
}

/** The chat a workspace-level surface acts on; see `resolveFocusedChatTarget`. */
export function useFocusedChatTarget(input: WorkspaceChatScope): FocusedChatTarget | null {
  const workspaceKey = useWorkspaceKey(input);
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  return useMemo(
    () => resolveFocusedChatTarget({ serverId: input.serverId, layout }),
    [input.serverId, layout],
  );
}

export function useAddFileToChat(input: WorkspaceChatScope) {
  const workspaceKey = useWorkspaceKey(input);
  const focusTab = useWorkspaceLayoutStore((state) => state.focusTab);
  const focusedChat = useFocusedChatTarget(input);
  const addFile = useCallback(
    async (filePath: string) => {
      if (!focusedChat || !workspaceKey) {
        return;
      }
      await useDraftStore.getState().attachWorkspaceFile({
        draftKey: focusedChat.draftKey,
        attachment: createWorkspaceFileAttachment({ path: filePath }),
      });
      focusTab(workspaceKey, focusedChat.tabId);
    },
    [focusTab, focusedChat, workspaceKey],
  );
  return { addFile, canAddToChat: focusedChat !== null };
}
