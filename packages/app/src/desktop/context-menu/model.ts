import type { DesktopContentContextMenu } from "@/desktop/host";

export enum ContentContextMenuAction {
  Copy = "copy",
  OpenLink = "open-link",
  CopyLink = "copy-link",
  CopyImage = "copy-image",
  SaveImage = "save-image",
}

export function getContentContextMenuActions(
  params: DesktopContentContextMenu,
): ContentContextMenuAction[] {
  if (params.hasImageContents && params.srcURL) {
    return [ContentContextMenuAction.CopyImage, ContentContextMenuAction.SaveImage];
  }
  const actions: ContentContextMenuAction[] = [];
  if (/^https?:/i.test(params.linkURL)) {
    actions.push(ContentContextMenuAction.OpenLink, ContentContextMenuAction.CopyLink);
  }
  if (params.selectionText) actions.push(ContentContextMenuAction.Copy);
  return actions;
}
