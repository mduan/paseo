import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { MessagePayload } from "@/composer/types";
import type {
  PendingNativeFork,
  PendingWorkspaceDraftSetup,
} from "@/stores/workspace-draft-submission-store";
import type { CreateEmptyWorkspaceInput } from "./new-workspace-empty";

function isLikelyWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path);
}

function isChatHistoryTextAttachment(attachment: AgentAttachment): boolean {
  return attachment.type === "text" && attachment.contextKind === "chat_history";
}

export function getWorkspaceNamingAttachments(
  attachments: readonly AgentAttachment[],
): AgentAttachment[] {
  return attachments.filter((attachment) => !isChatHistoryTextAttachment(attachment));
}

export function remapDraftCwdToWorkspace(input: {
  cwd: string;
  sourceDirectory?: string | null;
  workspaceDirectory: string;
}): string {
  const cwd = input.cwd.trim();
  const sourceDirectory = input.sourceDirectory?.trim();
  const workspaceDirectory = input.workspaceDirectory.trim();
  if (!cwd || !sourceDirectory) {
    return workspaceDirectory;
  }
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedSource = sourceDirectory.replace(/\\/g, "/").replace(/\/+$/, "");
  const compareCaseInsensitively =
    isLikelyWindowsPath(normalizedCwd) || isLikelyWindowsPath(normalizedSource);
  const comparableCwd = compareCaseInsensitively ? normalizedCwd.toLowerCase() : normalizedCwd;
  const comparableSource = compareCaseInsensitively
    ? normalizedSource.toLowerCase()
    : normalizedSource;
  if (comparableCwd === comparableSource) {
    return workspaceDirectory;
  }
  const relativePath = comparableCwd.startsWith(`${comparableSource}/`)
    ? normalizedCwd.slice(normalizedSource.length + 1)
    : "";
  if (!relativePath) {
    return workspaceDirectory;
  }
  const separator =
    workspaceDirectory.includes("\\") && !workspaceDirectory.includes("/") ? "\\" : "/";
  return [workspaceDirectory.replace(/[\\/]+$/, ""), ...relativePath.split("/")]
    .filter(Boolean)
    .join(separator);
}

/**
 * Finishes a full-history fork into a new workspace: creates the workspace with no
 * agent, forks the source agent into it, and sends any typed text as the fork's
 * next message.
 */
export async function runCreateNativeFork(input: {
  payload: MessagePayload;
  forkSetup: PendingWorkspaceDraftSetup & { nativeFork: PendingNativeFork };
  ensureWorkspace: CreateEmptyWorkspaceInput["ensureWorkspace"];
  client: DaemonClient;
  serverId: string;
  navigate: (input: { serverId: string; workspaceId: string; agentId: string }) => void;
}): Promise<void> {
  const { payload, forkSetup, client, serverId } = input;
  const workspace = await input.ensureWorkspace({
    cwd: payload.cwd,
    prompt: "",
    attachments: [],
    withInitialAgent: false,
  });
  const fork = await client.forkAgent(forkSetup.nativeFork.sourceAgentId, {
    ...forkSetup.nativeFork.boundary,
    cwd: remapDraftCwdToWorkspace({
      cwd: forkSetup.setup.cwd,
      sourceDirectory: forkSetup.sourceDirectory,
      workspaceDirectory: workspace.workspaceDirectory,
    }),
    workspaceId: workspace.id,
  });
  const text = payload.text.trim();
  if (text) {
    await client.sendAgentMessage(fork.id, text);
  }
  input.navigate({ serverId, workspaceId: workspace.id, agentId: fork.id });
}
