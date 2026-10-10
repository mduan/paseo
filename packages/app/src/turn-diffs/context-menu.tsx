import { useState, type PropsWithChildren } from "react";
import { Columns2, Diff, FolderSearch, Rows2 } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import { TurnDiffOpenLocation } from "@/hooks/use-settings/storage";
import { useStableEvent } from "@/hooks/use-stable-event";
import { usePaneContext } from "@/panels/pane-context";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { FilePaneAxis, resolveFilePanePlacement } from "@/workspace/file-open/pane";
import type { Theme } from "@/styles/theme";
import type { OpenTurnDiffInput } from "./card";

const ThemedDiff = withUnistyles(Diff);
const ThemedColumns = withUnistyles(Columns2);
const ThemedRows = withUnistyles(Rows2);
const ThemedExplorer = withUnistyles(FolderSearch);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const openIcon = <ThemedDiff size={16} uniProps={mutedColorMapping} />;
const horizontalIcon = <ThemedColumns size={16} uniProps={mutedColorMapping} />;
const verticalIcon = <ThemedRows size={16} uniProps={mutedColorMapping} />;
const explorerIcon = <ThemedExplorer size={16} uniProps={mutedColorMapping} />;

type TurnDiffContextMenuProps = PropsWithChildren<{
  turnId: string;
  onOpen?: (input: OpenTurnDiffInput) => void;
}>;

export function TurnDiffContextMenu({ children, ...props }: TurnDiffContextMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <ContextMenu open={open} onOpenChange={setOpen}>
      <ContextMenuTrigger contextOnly disabled={!props.onOpen}>
        {children}
      </ContextMenuTrigger>
      {open ? <TurnDiffMenuContent {...props} /> : null}
    </ContextMenu>
  );
}

function TurnDiffMenuContent({ turnId, onOpen }: TurnDiffContextMenuProps) {
  const { t } = useTranslation();
  const pane = usePaneContext();
  const isCompact = useIsCompactFormFactor();
  const canOpenPanes = !isCompact && supportsDesktopPaneSplits();
  const workspaceKey = buildWorkspaceTabPersistenceKey(pane);
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
  function openAt(destination: TurnDiffOpenLocation) {
    onOpen?.({ turnId, destination });
  }
  const openMain = useStableEvent(() => openAt(TurnDiffOpenLocation.Main));
  const openHorizontal = useStableEvent(() => openAt(TurnDiffOpenLocation.Horizontal));
  const openVertical = useStableEvent(() => openAt(TurnDiffOpenLocation.Vertical));
  const openExplorer = useStableEvent(() => openAt(TurnDiffOpenLocation.Explorer));
  return (
    <ContextMenuContent minWidth={230} testID="turn-diff-menu">
      <ContextMenuItem leading={openIcon} onSelect={openMain} testID="turn-diff-open">
        {t("workspace.chatFileMenu.open")}
      </ContextMenuItem>
      {canOpenPanes ? (
        <>
          <ContextMenuItem
            leading={horizontalIcon}
            disabled={!horizontal}
            onSelect={openHorizontal}
            testID="turn-diff-open-horizontal"
          >
            {t(`workspace.chatFileMenu.${horizontal?.position ?? "right"}`)}
          </ContextMenuItem>
          <ContextMenuItem
            leading={verticalIcon}
            disabled={!vertical}
            onSelect={openVertical}
            testID="turn-diff-open-vertical"
          >
            {t(`workspace.chatFileMenu.${vertical?.position ?? "bottom"}`)}
          </ContextMenuItem>
          <ContextMenuItem
            leading={explorerIcon}
            onSelect={openExplorer}
            testID="turn-diff-open-explorer"
          >
            {t("workspace.chatFileMenu.explorer")}
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  );
}
