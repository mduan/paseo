import type { normalizeWorkspaceDescriptor } from "@/stores/session-store";
import type { MessagePayload } from "@/composer/types";
import type { AgentAttachment, CreationSnapshot } from "@getpaseo/protocol/messages";

export function isEmptyWorkspaceSubmission(payload: MessagePayload): boolean {
  return !payload.text.trim() && payload.attachments.length === 0;
}

export interface CreateEmptyWorkspaceInput {
  payload: MessagePayload;
  ensureWorkspace: (input: {
    cwd: string;
    prompt: string;
    attachments: AgentAttachment[];
    withInitialAgent: boolean;
    onEvent?: (snapshot: CreationSnapshot) => void;
  }) => Promise<ReturnType<typeof normalizeWorkspaceDescriptor>>;
  onEvent?: (snapshot: CreationSnapshot) => void;
  serverId: string;
  navigate: (serverId: string, workspaceId: string) => void;
}

export async function runCreateEmptyWorkspace(input: CreateEmptyWorkspaceInput): Promise<void> {
  const { payload, ensureWorkspace, onEvent, serverId, navigate } = input;
  const ensuredWorkspace = await ensureWorkspace({
    cwd: payload.cwd,
    prompt: "",
    attachments: [],
    withInitialAgent: false,
    ...(onEvent ? { onEvent } : {}),
  });
  navigate(serverId, ensuredWorkspace.id);
}
