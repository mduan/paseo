import { useState, type PropsWithChildren } from "react";
import type { ViewStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { Columns2, Copy, File, FolderOpen, FolderSearch, Rows2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePaneContext } from "@/panels/pane-context";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { FilePaneAxis, resolveFilePanePlacement } from "@/workspace/file-open/pane";
import type { Theme } from "@/styles/theme";
import { normalizeInlinePathTarget, type InlinePathTarget } from "./parse";
import { useAssistantFileLinkResolverContext } from "./provider";
import type { AssistantFileLinkSource } from "./resolver";
import { useRevealInFileManager } from "@/workspace/open-in-file-manager/reveal";
import { useStableEvent } from "@/hooks/use-stable-event";

const ThemedFile = withUnistyles(File);
const ThemedColumns = withUnistyles(Columns2);
const ThemedRows = withUnistyles(Rows2);
const ThemedCopy = withUnistyles(Copy);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedFolderSearch = withUnistyles(FolderSearch);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const triggerStyle: ViewStyle = { display: "contents" as ViewStyle["display"] };
const openIcon = <ThemedFile size={16} uniProps={mutedColorMapping} />;
const horizontalIcon = <ThemedColumns size={16} uniProps={mutedColorMapping} />;
const verticalIcon = <ThemedRows size={16} uniProps={mutedColorMapping} />;
const copyIcon = <ThemedCopy size={16} uniProps={mutedColorMapping} />;
const fileManagerIcon = <ThemedFolderOpen size={16} uniProps={mutedColorMapping} />;
const revealIcon = <ThemedFolderSearch size={16} uniProps={mutedColorMapping} />;

type FileLinkContextMenuProps = PropsWithChildren<{
  source: AssistantFileLinkSource;
  target: InlinePathTarget | null;
  resolutionFailed: boolean;
  onResolve: () => void;
  onOpen: () => void;
}>;

export function FileLinkContextMenu({ children, onResolve, ...props }: FileLinkContextMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <ContextMenu open={open} onOpenChange={setOpen}>
      <ContextMenuTrigger contextOnly style={triggerStyle} onContextMenu={onResolve}>
        {children}
      </ContextMenuTrigger>
      {open ? <FileLinkMenuContent {...props} /> : null}
    </ContextMenu>
  );
}

function FileLinkMenuContent({
  target,
  source,
  resolutionFailed,
  onOpen,
}: Omit<FileLinkContextMenuProps, "children" | "onResolve">) {
  const { t } = useTranslation();
  const pane = usePaneContext();
  const isCompact = useIsCompactFormFactor();
  const { configRef } = useAssistantFileLinkResolverContext();
  const workspaceRoot = configRef.current.workspaceRoot;
  const fileManager = useRevealInFileManager({
    serverId: pane.serverId,
    workspaceRoot: workspaceRoot ?? "",
  });
  const path = target ? normalizeInlinePathTarget(target.path, workspaceRoot)?.file : undefined;
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: pane.serverId,
    workspaceId: pane.workspaceId,
  });
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const explorerPaneId = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.explorerSidebarPaneIdByWorkspace[workspaceKey] : undefined,
  );
  const horizontal = resolveFilePanePlacement({
    layout,
    sourceTabId: pane.tabId,
    explorerPaneId,
    axis: FilePaneAxis.Horizontal,
  });
  const vertical = resolveFilePanePlacement({
    layout,
    sourceTabId: pane.tabId,
    explorerPaneId,
    axis: FilePaneAxis.Vertical,
  });
  function openInPane(axis: FilePaneAxis) {
    if (!target || !path) return;
    pane.openFileInWorkspace({
      location: { path, lineStart: target.lineStart, lineEnd: target.lineEnd },
      disposition: "main",
      paneAxis: axis,
    });
  }
  const openHorizontal = useStableEvent(() => openInPane(FilePaneAxis.Horizontal));
  const openVertical = useStableEvent(() => openInPane(FilePaneAxis.Vertical));
  const copyPath = useStableEvent(() => {
    if (path) void pane.copyFilePath(path);
  });
  const revealFile = useStableEvent(() => {
    if (path) pane.revealFileInExplorer(path);
  });
  const revealInFileManager = useStableEvent(() => {
    if (path) void fileManager?.reveal(path);
  });
  return (
    <ContextMenuContent minWidth={230} testID="assistant-file-link-menu">
      <ContextMenuItem leading={openIcon} onSelect={onOpen} testID="assistant-file-link-open">
        {t("workspace.chatFileMenu.open")}
      </ContextMenuItem>
      {!isCompact ? (
        <>
          <ContextMenuItem
            leading={horizontalIcon}
            disabled={!path || !horizontal}
            onSelect={openHorizontal}
            testID="assistant-file-link-open-horizontal"
          >
            {t(`workspace.chatFileMenu.${horizontal?.position ?? "right"}`)}
          </ContextMenuItem>
          <ContextMenuItem
            leading={verticalIcon}
            disabled={!path || !vertical}
            onSelect={openVertical}
            testID="assistant-file-link-open-vertical"
          >
            {t(`workspace.chatFileMenu.${vertical?.position ?? "bottom"}`)}
          </ContextMenuItem>
        </>
      ) : null}
      <ContextMenuSeparator testID="assistant-file-link-open-separator" />
      <ContextMenuItem
        leading={copyIcon}
        disabled={!path}
        onSelect={copyPath}
        testID="assistant-file-link-copy-path"
      >
        {t("workspace.tabs.menu.copyFilePath")}
      </ContextMenuItem>
      <ContextMenuItem
        leading={revealIcon}
        disabled={!path}
        onSelect={revealFile}
        testID="assistant-file-link-reveal"
      >
        {t("workspace.tabs.menu.revealInExplorer")}
      </ContextMenuItem>
      {fileManager ? (
        <ContextMenuItem
          leading={fileManagerIcon}
          disabled={!path}
          onSelect={revealInFileManager}
          testID="assistant-file-link-reveal-in-file-manager"
        >
          {t("workspace.fileActions.revealIn", { target: fileManager.targetName })}
        </ContextMenuItem>
      ) : null}
      {!target ? (
        <ContextMenuLabel>
          {resolutionFailed
            ? t("common.errors.noFileFound", { token: source.text ?? source.href })
            : t("common.states.loading")}
        </ContextMenuLabel>
      ) : null}
    </ContextMenuContent>
  );
}
