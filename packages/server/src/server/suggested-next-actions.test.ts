import { expect, test } from "vitest";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { createTestLogger } from "../test-utils/test-logger.js";
import type { AgentManagerEvent, AgentSubscriber } from "./agent/agent-manager.js";
import type { AgentTimelineItem } from "./agent/agent-sdk-types.js";
import { attachSuggestedNextActions } from "./suggested-next-actions.js";

const TIMELINE: AgentTimelineItem[] = [
  { type: "user_message", text: "Fix the commit picker counts" },
  { type: "assistant_message", text: "Fixed. " },
  { type: "assistant_message", text: "I haven't added a test yet." },
];

interface FakeAgent {
  internal?: boolean;
  labels: Record<string, string>;
}

function setup(options: { enabled?: boolean; agents?: Record<string, FakeAgent> } = {}) {
  const agents = options.agents ?? { chat: { labels: {} } };
  const published = new Map<string, string[]>();
  const prompts: string[] = [];
  const pending: Array<(suggestions: string[]) => void> = [];
  let subscriber: AgentSubscriber | undefined;
  attachSuggestedNextActions({
    logger: createTestLogger(),
    agentManager: {
      subscribe: (callback) => {
        subscriber = callback;
        return () => {};
      },
      getAgent: ((id: string) => (agents[id] ? { id, ...agents[id] } : null)) as never,
      getTimeline: () => TIMELINE,
      setSuggestedNextActions: (id, suggestions) => published.set(id, suggestions),
    },
    isEnabled: () => options.enabled ?? true,
    generateSuggestions: ({ prompt }) => {
      prompts.push(prompt);
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  function completeTurn(agentId: string) {
    const event: AgentManagerEvent = {
      type: "agent_stream",
      agentId,
      event: { type: "turn_completed", provider: "claude" },
    };
    subscriber?.(event);
  }
  async function resolveGeneration(index: number, suggestions: string[]) {
    pending[index]?.(suggestions);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { published, prompts, pending, completeTurn, resolveGeneration };
}

test("publishes up to three unique suggestions after a completed turn", async () => {
  const { published, prompts, completeTurn, resolveGeneration } = setup();

  completeTurn("chat");
  await resolveGeneration(0, ["Add a test", " Add a test ", "Commit", "", "Push", "Open a PR"]);

  expect(published.get("chat")).toEqual(["Add a test", "Commit", "Push"]);
  expect(prompts[0]).toContain("Fix the commit picker counts");
  expect(prompts[0]).toContain("Fixed. I haven't added a test yet.");
});

test("drops a result that arrives after a newer turn completed", async () => {
  const { published, completeTurn, resolveGeneration } = setup();

  completeTurn("chat");
  completeTurn("chat");
  await resolveGeneration(0, ["Stale"]);
  expect(published.has("chat")).toBe(false);

  await resolveGeneration(1, ["Fresh"]);
  expect(published.get("chat")).toEqual(["Fresh"]);
});

test("skips disabled hosts, internal agents, and subagents", () => {
  const disabled = setup({ enabled: false });
  disabled.completeTurn("chat");
  expect(disabled.pending).toHaveLength(0);

  const { pending, completeTurn } = setup({
    agents: {
      namer: { internal: true, labels: {} },
      child: { labels: { [PARENT_AGENT_ID_LABEL]: "parent" } },
    },
  });
  completeTurn("namer");
  completeTurn("child");
  expect(pending).toHaveLength(0);
});
