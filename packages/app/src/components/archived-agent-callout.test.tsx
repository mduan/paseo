/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { normalizeAgentSnapshot, projectAgentSnapshot } from "@/utils/agent-snapshots";
import { ArchivedAgentCallout } from "./archived-agent-callout";

const client = vi.hoisted(() => ({ refreshAgent: vi.fn(), fetchAgent: vi.fn() }));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => client,
  useHostRuntimeIsConnected: () => true,
  getHostRuntimeStore: () => ({
    acceptAgentSnapshot(serverId: string, agent: Agent) {
      useSessionStore.getState().setAgents(serverId, new Map([[agent.id, agent]]));
    },
  }),
}));
vi.mock("@/keyboard/shift", () => ({
  KeyboardTranslateView: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const serverId = "unarchive-test";
const agentId = "archived-child";
let root: Root;
let container: HTMLDivElement;

function AgentFooter() {
  const archivedAt = useSessionStore(
    (state) =>
      (
        state.sessions[serverId]?.agents.get(agentId) ??
        state.sessions[serverId]?.agentDetails.get(agentId)
      )?.archivedAt,
  );
  return archivedAt ? (
    <ArchivedAgentCallout serverId={serverId} agentId={agentId} />
  ) : (
    <div>Composer</div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.getState().initializeSession(serverId, null);
  const agent = normalizeAgentSnapshot(
    {
      id: agentId,
      provider: "codex",
      cwd: "/repo",
      workspaceId: "workspace",
      model: null,
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:01:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: "Archived child",
      labels: { [PARENT_AGENT_ID_LABEL]: "parent" },
      archivedAt: "2026-10-16T00:01:00.000Z",
    },
    serverId,
  );
  useSessionStore.getState().setAgentDetails(serverId, new Map([[agentId, agent]]));
  client.refreshAgent.mockResolvedValue({});
  client.fetchAgent.mockResolvedValue({
    agent: { ...projectAgentSnapshot(agent), archivedAt: null },
    project: {
      projectKey: "/repo",
      projectName: "repo",
      checkout: {
        cwd: "/repo",
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<AgentFooter />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSessionStore.getState().clearSession(serverId);
});

it("restores the composer after Unarchive succeeds without a directory upsert", async () => {
  const button = container.querySelector('[role="button"]');
  if (!(button instanceof HTMLElement)) throw new Error("Unarchive button is missing");
  await act(async () => button.click());
  expect(client.refreshAgent).toHaveBeenCalledWith(agentId);
  expect(container.textContent).toBe("Composer");
  expect(useSessionStore.getState().sessions[serverId]?.agents.get(agentId)?.parentAgentId).toBe(
    "parent",
  );
});

it.each(["refreshAgent", "fetchAgent"] as const)(
  "shows a %s failure and allows retry",
  async (operation) => {
    client[operation].mockRejectedValueOnce(new Error("Host request failed"));
    const button = container.querySelector('[role="button"]');
    if (!(button instanceof HTMLElement)) throw new Error("Unarchive button is missing");
    await act(async () => button.click());
    expect(container.querySelector('[data-testid="agent-unarchive-error"]')?.textContent).toBe(
      "Host request failed",
    );
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => button.click());
    expect(container.textContent).toBe("Composer");
  },
);

it("allows retry when the restored agent cannot be found", async () => {
  client.fetchAgent.mockResolvedValueOnce(null);
  const button = container.querySelector('[role="button"]');
  if (!(button instanceof HTMLElement)) throw new Error("Unarchive button is missing");
  await act(async () => button.click());
  expect(container.querySelector('[data-testid="agent-unarchive-error"]')?.textContent).toBe(
    `Agent not found: ${agentId}`,
  );
  expect(button.getAttribute("aria-disabled")).not.toBe("true");
});
