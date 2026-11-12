import type { Logger } from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";

/**
 * Stamps `lastAgentResponseAt` on the owning workspace each time a live agent turn completes,
 * whoever prompted it. History replays never reach subscribers, so restarts don't move it.
 */
export function attachWorkspaceResponseRecorder(input: {
  logger: Logger;
  agentManager: Pick<AgentManager, "subscribe" | "getAgent">;
  workspaceRegistry: Pick<WorkspaceRegistry, "update">;
}): () => void {
  const { logger, agentManager, workspaceRegistry } = input;
  return agentManager.subscribe(
    (event) => {
      if (event.type !== "agent_stream" || event.event.type !== "turn_completed") return;
      const agent = agentManager.getAgent(event.agentId);
      if (!agent?.workspaceId || agent.internal) return;
      const lastAgentResponseAt = event.timestamp ?? new Date().toISOString();
      void workspaceRegistry
        .update(agent.workspaceId, (existing) => ({ ...existing, lastAgentResponseAt }))
        .catch((error) => {
          logger.warn(
            { err: error, agentId: event.agentId, workspaceId: agent.workspaceId },
            "Failed to record agent response time",
          );
        });
    },
    { replayState: false },
  );
}
