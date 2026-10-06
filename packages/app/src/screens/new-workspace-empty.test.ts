import { describe, expect, it, vi } from "vitest";
import type { ComposerAttachment } from "@/attachments/types";
import type { MessagePayload } from "@/composer/types";
import type { CreationSnapshot } from "@getpaseo/protocol/messages";
import { isEmptyWorkspaceSubmission, runCreateEmptyWorkspace } from "./new-workspace-empty";

function payload(
  input: { text?: string; attachments?: ComposerAttachment[] } = {},
): MessagePayload {
  return { text: input.text ?? "", attachments: input.attachments ?? [], cwd: "/sample/repo" };
}

function createRecordingNavigate() {
  const recorded: Array<{ serverId: string; workspaceId: string }> = [];
  return {
    recorded,
    navigate: (serverId: string, workspaceId: string) => {
      recorded.push({ serverId, workspaceId });
    },
  };
}

describe("runCreateEmptyWorkspace", () => {
  it("creates a workspace without prompt or attachments and navigates to it", async () => {
    const workspace = { id: "workspace-123" };
    const ensureWorkspace = vi.fn().mockResolvedValue(workspace);
    const { navigate, recorded } = createRecordingNavigate();

    await runCreateEmptyWorkspace({
      payload: payload(),
      ensureWorkspace,
      serverId: "server-abc",
      navigate,
    });

    expect(ensureWorkspace).toHaveBeenCalledOnce();
    expect(ensureWorkspace).toHaveBeenCalledWith({
      cwd: "/sample/repo",
      prompt: "",
      attachments: [],
      withInitialAgent: false,
    });
    expect(recorded).toEqual([{ serverId: "server-abc", workspaceId: "workspace-123" }]);
  });
});

describe("runCreateEmptyWorkspace creation events", () => {
  it("forwards creation snapshots to the caller while the workspace is created", async () => {
    const accepted: CreationSnapshot = {
      kind: "workspace",
      idempotencyKey: "key-1",
      revision: 1,
      phase: "accepted",
      workspaceId: "workspace-123",
      agentId: null,
      error: null,
    };
    const ensureWorkspace = vi
      .fn()
      .mockImplementation(async (request: { onEvent?: (snapshot: CreationSnapshot) => void }) => {
        request.onEvent?.(accepted);
        return { id: "workspace-123" };
      });
    const snapshots: CreationSnapshot[] = [];
    const { navigate, recorded } = createRecordingNavigate();

    await runCreateEmptyWorkspace({
      payload: payload(),
      ensureWorkspace,
      onEvent: (snapshot) => snapshots.push(snapshot),
      serverId: "server-abc",
      navigate,
    });

    expect(snapshots).toEqual([accepted]);
    expect(recorded).toEqual([{ serverId: "server-abc", workspaceId: "workspace-123" }]);
  });
});

describe("isEmptyWorkspaceSubmission", () => {
  it("treats whitespace-only text with no attachments as empty, but any attachment as non-empty", () => {
    const attachment: ComposerAttachment = {
      kind: "image",
      metadata: {
        id: "image-1",
        mimeType: "image/png",
        storageType: "web-indexeddb",
        storageKey: "image-1",
        createdAt: 0,
      },
    };

    expect(isEmptyWorkspaceSubmission(payload({ text: " \n\t " }))).toBe(true);
    expect(isEmptyWorkspaceSubmission(payload({ attachments: [attachment] }))).toBe(false);
  });
});
