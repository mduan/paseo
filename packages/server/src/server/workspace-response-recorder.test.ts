import { expect, test } from "vitest";
import { createTestLogger } from "../test-utils/test-logger.js";
import type { AgentManagerEvent, AgentSubscriber } from "./agent/agent-manager.js";
import {
  createPersistedWorkspaceRecord,
  type PersistedWorkspaceRecord,
} from "./workspace-registry.js";
import { attachWorkspaceResponseRecorder } from "./workspace-response-recorder.js";

test("stamps the workspace when a non-internal agent completes a turn", async () => {
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "ws-1",
    projectId: "proj-1",
    cwd: "/tmp/repo",
    kind: "directory",
    displayName: "repo",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  });
  const agents: Record<string, { workspaceId: string; internal?: boolean }> = {
    chat: { workspaceId: "ws-1" },
    namer: { workspaceId: "ws-1", internal: true },
  };
  let subscriber: AgentSubscriber | undefined;
  attachWorkspaceResponseRecorder({
    logger: createTestLogger(),
    agentManager: {
      subscribe: (callback) => {
        subscriber = callback;
        return () => {};
      },
      getAgent: ((id: string) => agents[id] ?? null) as never,
    },
    workspaceRegistry: {
      update: async (
        _id,
        updater: (record: PersistedWorkspaceRecord) => PersistedWorkspaceRecord,
      ) => (workspace = updater(workspace)),
    },
  });
  const completed = (agentId: string, timestamp: string): AgentManagerEvent => ({
    type: "agent_stream",
    agentId,
    timestamp,
    event: { type: "turn_completed", provider: "codex" },
  });

  subscriber?.(completed("namer", "2026-03-02T00:00:00.000Z"));
  await Promise.resolve();
  expect(workspace.lastAgentResponseAt).toBeUndefined();

  subscriber?.(completed("chat", "2026-03-03T00:00:00.000Z"));
  await Promise.resolve();
  expect(workspace.lastAgentResponseAt).toBe("2026-03-03T00:00:00.000Z");
});
