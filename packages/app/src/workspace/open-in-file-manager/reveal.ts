import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";

// oxlint-disable-next-line typescript/consistent-type-definitions -- AGENTS.md requires type aliases.
export type RevealInFileManagerAction = {
  targetName: string;
  reveal: (path: string) => Promise<void>;
};

// oxlint-disable-next-line typescript/consistent-type-definitions -- AGENTS.md requires type aliases.
type UseRevealInFileManagerInput = {
  serverId: string;
  workspaceRoot: string;
};

export function useRevealInFileManager({
  serverId,
  workspaceRoot,
}: UseRevealInFileManagerInput): RevealInFileManagerAction | undefined {
  const { t } = useTranslation();
  const toast = useToast();
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const { targets } = useDesktopOpenTargets({ isLocalExecution: isLocalDaemon });
  const fileManagerTarget = targets.find((target) => target.kind === "file-manager");
  const reveal = useCallback(
    async (path: string) => {
      if (!fileManagerTarget) return;
      try {
        await openDesktopTarget({
          editorId: fileManagerTarget.id,
          workspacePath: workspaceRoot,
          filePath: buildAbsoluteExplorerPath({ workspaceRoot, entryPath: path }),
        });
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : t("workspace.fileExplorer.errors.revealFailed"),
        );
      }
    },
    [fileManagerTarget, workspaceRoot, t, toast],
  );
  return useMemo(
    () =>
      fileManagerTarget && workspaceRoot
        ? { targetName: fileManagerTarget.label, reveal }
        : undefined,
    [fileManagerTarget, workspaceRoot, reveal],
  );
}
