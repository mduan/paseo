import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { markAgentUnread } from "@/workspace/mark-unread";

export function useMarkAgentUnread(serverId: string) {
  const { t } = useTranslation();
  const toast = useToast();
  const supported = useHostFeature(serverId, "agentMarkUnread");
  const { mutate } = useMutation({
    mutationFn: (agentId: string) => markAgentUnread({ serverId, agentId }),
    onMutate: () => toast.show(t("workspace.tabs.menu.markingUnread")),
    onSuccess: () => toast.show(t("workspace.tabs.menu.markedUnread"), { variant: "success" }),
    onError: (error) => toast.error(error.message),
  });
  const markUnread = useCallback((agentId: string) => mutate(agentId), [mutate]);
  return supported ? markUnread : undefined;
}
