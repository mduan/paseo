// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type AgentCommandsClient,
  type DraftCommandConfig,
  fetchAgentCommands,
  useAgentCommandsQuery,
} from "./use-agent-commands-query";

const runtime = vi.hoisted(() => ({ listCommands: vi.fn() }));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => runtime,
  useHostRuntimeIsConnected: () => true,
}));
vi.mock("@/components/retained-panel", () => ({
  useRetainedPanelActive: () => true,
}));

type ListCommands = AgentCommandsClient["listCommands"];
type ListCommandsResult = Awaited<ReturnType<ListCommands>>;

interface ListCommandsCall {
  agentId: string;
  draftConfig: DraftCommandConfig | undefined;
}

interface FakeAgentCommandsClient extends AgentCommandsClient {
  calls: ListCommandsCall[];
}

function createClient(response: ListCommandsResult): FakeAgentCommandsClient {
  const calls: ListCommandsCall[] = [];
  return {
    calls,
    listCommands: (async (options: Parameters<ListCommands>[0]) => {
      calls.push({ agentId: options.agentId, draftConfig: options.draftConfig });
      return response;
    }) as ListCommands,
  };
}

function commandsPayload(commands: ListCommandsResult["commands"]): ListCommandsResult {
  return {
    requestId: "req_commands",
    agentId: "",
    error: null,
    commands,
  };
}

describe("fetchAgentCommands", () => {
  it("loads commands for a draft composer without an agent id", async () => {
    const client = createClient(
      commandsPayload([{ name: "compact", description: "Compact context", argumentHint: "" }]),
    );

    const draftConfig: DraftCommandConfig = {
      provider: "opencode",
      cwd: "/repo",
      modeId: "build",
    };

    const commands = await fetchAgentCommands({ client, agentId: "", draftConfig });

    expect(commands).toEqual([
      { name: "compact", description: "Compact context", argumentHint: "" },
    ]);
    expect(client.calls).toEqual([{ agentId: "", draftConfig }]);
  });

  it("passes the agent id when fetching commands for a running agent", async () => {
    const client = createClient(commandsPayload([]));

    await fetchAgentCommands({ client, agentId: "agent-1" });

    expect(client.calls).toEqual([{ agentId: "agent-1", draftConfig: undefined }]);
  });
});

describe("useAgentCommandsQuery", () => {
  it("refreshes added project skills when reopening an older draft command menu", async () => {
    const queryClient = new QueryClient();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const releaseBeta = { name: "release-beta", description: "Release beta", argumentHint: "" };
    const releaseFork = { name: "release-fork", description: "Release fork", argumentHint: "" };
    runtime.listCommands.mockResolvedValue(commandsPayload([releaseBeta]));

    const { result, rerender, unmount } = renderHook(
      ({ enabled }) =>
        useAgentCommandsQuery({
          serverId: "server-1",
          agentId: "",
          draftConfig: { provider: "codex", cwd: "/repo", model: "gpt-5.5" },
          enabled,
        }),
      {
        initialProps: { enabled: true },
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      },
    );

    try {
      await waitFor(() => expect(result.current.commands).toEqual([releaseBeta]));
      rerender({ enabled: false });
      runtime.listCommands.mockResolvedValue(commandsPayload([releaseBeta, releaseFork]));
      clock.mockReturnValue(now + 60_001);
      rerender({ enabled: true });

      await waitFor(() => expect(result.current.commands).toContainEqual(releaseFork));
    } finally {
      unmount();
      queryClient.clear();
      clock.mockRestore();
    }
  });
});
