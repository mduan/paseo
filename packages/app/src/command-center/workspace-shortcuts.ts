import {
  resolveShortcutKeysForAction,
  type ShortcutOverrides,
} from "@/keyboard/keyboard-shortcuts";
import type { WorkspaceCommandCenterShortcuts } from "./workspace-contributions";

interface ResolveWorkspaceCommandCenterShortcutsInput {
  overrides: ShortcutOverrides;
  platform: { isMac: boolean; isDesktop: boolean };
}

// Each palette command and the Settings shortcut help id whose keys it shows.
const SHORTCUT_HELP_IDS: Record<keyof WorkspaceCommandCenterShortcuts, string> = {
  newAgent: "workspace-tab-target-agent",
  newTerminal: "workspace-terminal-new",
  splitRight: "workspace-pane-split-right",
  splitDown: "workspace-pane-split-down",
  archiveWorkspace: "archive-workspace",
  previousTab: "workspace-tab-prev",
  nextTab: "workspace-tab-next",
  closeCurrentTab: "workspace-tab-close-current",
  closePane: "workspace-pane-close",
  toggleFocusMode: "toggle-focus",
  toggleExplorerSidebar: "toggle-right-sidebar",
  pinWorkspace: "pin-workspace",
  renameWorkspace: "rename-workspace",
  renameTab: "workspace-tab-rename",
  newTab: "workspace-tab-new",
  newBrowser: "workspace-tab-target-browser",
  changes: "workspace-tab-target-changes",
  files: "workspace-tab-target-files",
  searchFiles: "search-files",
  previousWorkspace: "workspace-prev",
  nextWorkspace: "workspace-next",
  focusPaneLeft: "workspace-pane-focus-left",
  focusPaneRight: "workspace-pane-focus-right",
  focusPaneUp: "workspace-pane-focus-up",
  focusPaneDown: "workspace-pane-focus-down",
  moveTabLeft: "workspace-pane-move-tab-left",
  moveTabRight: "workspace-pane-move-tab-right",
  moveTabUp: "workspace-pane-move-tab-up",
  moveTabDown: "workspace-pane-move-tab-down",
  focusMessageInput: "focus-message-input",
  cycleAgentMode: "cycle-agent-mode",
  toggleVoiceMode: "voice-toggle",
  toggleDictation: "dictation-toggle",
  interruptAgent: "agent-interrupt",
  toggleVoiceMute: "voice-mute-toggle",
};

export function resolveWorkspaceCommandCenterShortcuts({
  overrides,
  platform,
}: ResolveWorkspaceCommandCenterShortcutsInput): WorkspaceCommandCenterShortcuts {
  const shortcuts: WorkspaceCommandCenterShortcuts = {};
  for (const [name, helpId] of Object.entries(SHORTCUT_HELP_IDS)) {
    shortcuts[name as keyof WorkspaceCommandCenterShortcuts] =
      resolveShortcutKeysForAction(helpId, overrides, platform) ?? undefined;
  }
  return shortcuts;
}
