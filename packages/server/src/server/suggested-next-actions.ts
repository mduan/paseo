import type { Logger } from "pino";
import { z } from "zod";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { AgentManager, ManagedAgent } from "./agent/agent-manager.js";
import type { AgentTimelineItem } from "./agent/agent-sdk-types.js";
import {
  generateStructuredAgentResponseWithFallback,
  StructuredAgentFallbackError,
} from "./agent/agent-response-loop.js";
import { resolveStructuredGenerationProviders } from "./agent/structured-generation-providers.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import type { MutableDaemonConfig } from "./daemon-config-store.js";

const MAX_SUGGESTIONS = 3;
const MAX_MESSAGE_CHARS = 4000;

const SuggestionsSchema = z.object({ suggestions: z.array(z.string()) });

type GenerateSuggestions = (input: { agent: ManagedAgent; prompt: string }) => Promise<string[]>;

/** Publishes up to three suggested follow-ups after each top-level turn; drops stale results. */
export function attachSuggestedNextActions(input: {
  logger: Logger;
  agentManager: Pick<
    AgentManager,
    "subscribe" | "getAgent" | "getTimeline" | "setSuggestedNextActions"
  >;
  isEnabled: () => boolean;
  generateSuggestions: GenerateSuggestions;
}): () => void {
  const { logger, agentManager } = input;
  const latestCompletionByAgent = new Map<string, number>();

  async function suggest(agent: ManagedAgent, completion: number): Promise<void> {
    const prompt = buildPrompt(agentManager.getTimeline(agent.id));
    if (!prompt) return;
    const suggestions = normalizeSuggestions(await input.generateSuggestions({ agent, prompt }));
    if (latestCompletionByAgent.get(agent.id) !== completion) return;
    agentManager.setSuggestedNextActions(agent.id, suggestions);
  }

  return agentManager.subscribe(
    (event) => {
      if (event.type !== "agent_stream" || event.event.type !== "turn_completed") return;
      const agent = agentManager.getAgent(event.agentId);
      if (!agent || agent.internal || agent.labels[PARENT_AGENT_ID_LABEL]) return;
      if (!input.isEnabled()) return;
      const completion = (latestCompletionByAgent.get(event.agentId) ?? 0) + 1;
      latestCompletionByAgent.set(event.agentId, completion);
      void suggest(agent, completion).catch((error) => {
        logger.warn({ err: error, agentId: event.agentId }, "Suggested next actions failed");
      });
    },
    { replayState: false },
  );
}

/** Generates suggestions with the configured suggestion model, then the metadata model chain. */
export function createSuggestionGenerator(input: {
  logger: Logger;
  agentManager: AgentManager;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
  readMetadataGeneration: () => MutableDaemonConfig["metadataGeneration"];
}): GenerateSuggestions {
  return async ({ agent, prompt }) => {
    const metadataGeneration = input.readMetadataGeneration();
    const providers = await resolveStructuredGenerationProviders({
      cwd: agent.cwd,
      providerSnapshotManager: input.providerSnapshotManager,
      daemonConfig: {
        metadataGeneration: {
          providers: [
            ...(metadataGeneration.suggestedNextActions?.providers ?? []),
            ...metadataGeneration.providers,
          ],
        },
      },
      currentSelection: agent.config,
    });
    try {
      const result = await generateStructuredAgentResponseWithFallback({
        manager: input.agentManager,
        cwd: agent.cwd,
        prompt,
        schema: SuggestionsSchema,
        schemaName: "SuggestedNextActions",
        maxRetries: 1,
        providers,
        persistSession: false,
        logger: input.logger,
        agentConfigOverrides: { title: "Next action suggester", internal: true },
      });
      return result.suggestions;
    } catch (error) {
      if (!(error instanceof StructuredAgentFallbackError)) throw error;
      input.logger.warn({ err: error, attempts: error.attempts }, "No model could suggest");
      return [];
    }
  };
}

function buildPrompt(timeline: readonly AgentTimelineItem[]): string | null {
  const lastUserIndex = timeline.findLastIndex((item) => item.type === "user_message");
  const lastUser = timeline[lastUserIndex];
  const lastAssistantIndex = timeline.findLastIndex((item) => item.type === "assistant_message");
  // No reply after the last message means there is nothing to follow up on.
  if (lastAssistantIndex < 0 || lastAssistantIndex < lastUserIndex) return null;
  // Providers stream one reply as several contiguous chunks.
  let start = lastAssistantIndex;
  while (start > 0 && timeline[start - 1]?.type === "assistant_message") start -= 1;
  const reply = timeline
    .slice(start, lastAssistantIndex + 1)
    .map((item) => (item.type === "assistant_message" ? item.text : ""))
    .join("");

  return [
    "You suggest the next message a developer will send to their coding agent.",
    "Read the developer's last message and the agent's reply, then return 1 to 3 short follow-up messages in the developer's voice, as instructions to the agent (for example: “Apply that fix”, “Run the tests”, “Commit these changes”).",
    "Most replies have an obvious next step: approve a proposed change, verify the work, commit it, or continue the plan.",
    "When the agent offers choices, suggest the choices as replies.",
    "Return an empty list only when the agent asked an open-ended question that needs the developer's own input, or when the task is finished and nothing follows.",
    "Keep each suggestion under 80 characters. Do not ask for work the agent already did.",
    "",
    "<developer_message>",
    lastUser?.type === "user_message" ? truncate(lastUser.text) : "(none)",
    "</developer_message>",
    "<agent_reply>",
    truncate(reply),
    "</agent_reply>",
  ].join("\n");
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
}

function normalizeSuggestions(suggestions: readonly string[]): string[] {
  const unique = new Set(suggestions.map((suggestion) => suggestion.trim()).filter(Boolean));
  return Array.from(unique).slice(0, MAX_SUGGESTIONS);
}
