import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Copy, Download, ExternalLink, Image } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  useContextMenu,
} from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-api-context";
import { getDesktopHost, type DesktopContentContextMenu } from "@/desktop/host";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { useStableEvent } from "@/hooks/use-stable-event";
import { createAssistantSelectionClipboardContent } from "@/assistant-selection-copy/content.web";
import {
  createCodeClipboardContent,
  writeRichClipboardContent,
  type MarkdownClipboardContent,
} from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { openExternalUrl } from "@/utils/open-external-url";
import type { Theme } from "@/styles/theme";
import { getIsElectron } from "@/constants/platform";
import { OverlayLayerProvider, OVERLAY_Z, useGlobalWebOverlayLayer } from "@/lib/overlay-root";
import { ContentContextMenuAction, getContentContextMenuActions } from "./model";

const ThemedCopy = withUnistyles(Copy);
const ThemedDownload = withUnistyles(Download);
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedImage = withUnistyles(Image);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const icons = {
  [ContentContextMenuAction.Copy]: <ThemedCopy size={16} uniProps={mutedMapping} />,
  [ContentContextMenuAction.CopyLink]: <ThemedCopy size={16} uniProps={mutedMapping} />,
  [ContentContextMenuAction.CopyImage]: <ThemedImage size={16} uniProps={mutedMapping} />,
  [ContentContextMenuAction.SaveImage]: <ThemedDownload size={16} uniProps={mutedMapping} />,
  [ContentContextMenuAction.OpenLink]: <ThemedExternalLink size={16} uniProps={mutedMapping} />,
};
const labelKeys = {
  [ContentContextMenuAction.Copy]: "common.actions.copy",
  [ContentContextMenuAction.CopyLink]: "desktop.contextMenu.copyLinkAddress",
  [ContentContextMenuAction.CopyImage]: "desktop.contextMenu.copyImage",
  [ContentContextMenuAction.SaveImage]: "desktop.contextMenu.saveImage",
  [ContentContextMenuAction.OpenLink]: "desktop.contextMenu.openLink",
} as const;

// eslint-disable-next-line typescript/consistent-type-definitions -- AGENTS.md prefers type aliases.
type MenuSnapshot = {
  params: DesktopContentContextMenu;
  actions: ContentContextMenuAction[];
  selection: MarkdownClipboardContent;
};

export function DesktopContentContextMenuHost() {
  if (!getIsElectron()) return null;
  return (
    <ContextMenu compactMode="popover">
      <ContentContextMenu />
    </ContextMenu>
  );
}

function ContentContextMenu() {
  const { t } = useTranslation();
  const toast = useToast();
  const { open, setOpen, setAnchorRect } = useContextMenu();
  const floatingLayer = useGlobalWebOverlayLayer("floating", open);
  const [snapshot, setSnapshot] = useState<MenuSnapshot>();
  const { mutate, reset, isPending, isError, variables } = useMutation({
    mutationFn: async (action: ContentContextMenuAction) => {
      if (!snapshot) throw new Error("No context menu is open.");
      switch (action) {
        case ContentContextMenuAction.Copy:
          await writeRichClipboardContent(
            snapshot.selection,
            getDefaultMarkdownClipboardEnvironment(),
          );
          return;
        case ContentContextMenuAction.CopyLink:
          await copyToClipboard(snapshot.params.linkURL);
          return;
        case ContentContextMenuAction.OpenLink:
          await openExternalUrl(snapshot.params.linkURL);
          return;
        case ContentContextMenuAction.CopyImage: {
          const copyImage = getDesktopHost()?.menu?.copyImage;
          if (!copyImage) throw new Error("Desktop image copying is unavailable.");
          await copyImage();
          return;
        }
        case ContentContextMenuAction.SaveImage: {
          const saveImage = getDesktopHost()?.menu?.saveImage;
          if (!saveImage) throw new Error("Desktop image saving is unavailable.");
          await saveImage();
          return;
        }
      }
    },
    onSuccess: (_result, action) => {
      if (
        action === ContentContextMenuAction.Copy ||
        action === ContentContextMenuAction.CopyLink ||
        action === ContentContextMenuAction.CopyImage
      ) {
        toast.copied();
      }
      setOpen(false);
    },
  });

  const openMenu = useStableEvent((params: DesktopContentContextMenu) => {
    if (isPending) return;
    const actions = getContentContextMenuActions(params);
    if (!actions.length) {
      setOpen(false);
      return;
    }
    const selection =
      createAssistantSelectionClipboardContent(window.getSelection()) ??
      createCodeClipboardContent(params.selectionText, {
        block: params.selectionText.includes("\n"),
      });
    setSnapshot({ params, actions, selection });
    reset();
    setAnchorRect({ x: params.x, y: params.y, width: 0, height: 0 });
    setOpen(true);
  });

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenToDesktopEvent<DesktopContentContextMenu>("content-context-menu", openMenu)
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
        return undefined;
      })
      .catch(() => toast.error(t("desktop.contextMenu.actionFailed")));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openMenu, t, toast]);

  const selectAction = useCallback((action: ContentContextMenuAction) => mutate(action), [mutate]);
  const rows = useMemo(
    () =>
      snapshot?.actions.map((action, index) => (
        <ContentContextMenuRow
          key={action}
          action={action}
          onSelect={selectAction}
          pending={isPending && variables === action}
          disabled={isPending}
          separator={index > 0 && action === ContentContextMenuAction.Copy}
          failed={isError && variables === action}
        />
      )),
    [isError, isPending, selectAction, snapshot?.actions, variables],
  );

  return (
    <OverlayLayerProvider layer={floatingLayer - OVERLAY_Z.floating}>
      <ContextMenuContent align="start" minWidth={210} testID="desktop-content-context-menu">
        {rows}
      </ContextMenuContent>
    </OverlayLayerProvider>
  );
}

// eslint-disable-next-line typescript/consistent-type-definitions -- AGENTS.md prefers type aliases.
type ContentContextMenuRowProps = {
  action: ContentContextMenuAction;
  onSelect: (action: ContentContextMenuAction) => void;
  pending: boolean;
  failed: boolean;
  disabled: boolean;
  separator: boolean;
};

function ContentContextMenuRow({
  action,
  onSelect,
  pending,
  failed,
  disabled,
  separator,
}: ContentContextMenuRowProps) {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(action), [action, onSelect]);
  return (
    <>
      {separator ? <ContextMenuSeparator /> : null}
      <ContextMenuItem
        leading={icons[action]}
        onSelect={select}
        disabled={disabled}
        status={pending ? "pending" : "idle"}
        description={failed ? t("desktop.contextMenu.actionFailed") : undefined}
        closeOnSelect={false}
        testID={`desktop-content-context-menu-${action}`}
      >
        {t(labelKeys[action])}
      </ContextMenuItem>
    </>
  );
}
