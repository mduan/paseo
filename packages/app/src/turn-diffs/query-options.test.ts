import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { AgentTurnDiffPayload } from "@getpaseo/client/internal/daemon-client";
import { describe, expect, it } from "vitest";
import { fetchQueryOptions } from "@/data/query";
import { agentTurnDiffQueryOptions } from "./query-options";

const payload: AgentTurnDiffPayload = {
  requestId: "request-1",
  agentId: "agent-1",
  cwd: "/repo",
  available: true,
  error: null,
  files: [{ path: "a.ts", isNew: true, isDeleted: false, additions: 1, deletions: 0, hunks: [] }],
};

describe("turn diff fetching", () => {
  it("shares an unfinished preload with the panel opened by a click", async () => {
    const queryClient = new QueryClient();
    const pending = Promise.withResolvers<AgentTurnDiffPayload>();
    let calls = 0;
    const options = fetchQueryOptions(
      agentTurnDiffQueryOptions({
        serverId: "host",
        agentId: "agent-1",
        target: { kind: "turn", turnId: "turn-1" },
        ignoreWhitespace: false,
        latestTurnDiffAt: "first",
        enabled: true,
        client: {
          getAgentTurnDiff() {
            calls++;
            return pending.promise;
          },
        },
      }),
    );
    const preload = queryClient.prefetchQuery(options);
    const observer = new QueryObserver(queryClient, options);
    const detach = observer.subscribe(() => {});
    try {
      expect(calls).toBe(1);
      pending.resolve(payload);
      await preload;
      expect(observer.getCurrentResult().data).toBe(payload);
    } finally {
      pending.resolve(payload);
      detach();
      queryClient.clear();
    }
  });

  it("opens a preloaded turn immediately even after another turn completes", async () => {
    const queryClient = new QueryClient();
    let calls = 0;
    const input = {
      serverId: "host",
      agentId: "agent-1",
      target: { kind: "turn", turnId: "turn-1" } as const,
      ignoreWhitespace: false,
      latestTurnDiffAt: "first",
      enabled: true,
      client: {
        async getAgentTurnDiff() {
          calls++;
          return payload;
        },
      },
    };
    await queryClient.prefetchQuery(fetchQueryOptions(agentTurnDiffQueryOptions(input)));
    const observer = new QueryObserver(
      queryClient,
      fetchQueryOptions(agentTurnDiffQueryOptions({ ...input, latestTurnDiffAt: "second" })),
    );
    const detach = observer.subscribe(() => {});
    try {
      expect(observer.getCurrentResult().data).toBe(payload);
      expect(observer.getCurrentResult().isFetching).toBe(false);
      expect(calls).toBe(1);
    } finally {
      detach();
      queryClient.clear();
    }
  });

  it("refreshes Last Turn when the agent records another snapshot", async () => {
    const queryClient = new QueryClient();
    let calls = 0;
    const input = {
      serverId: "host",
      agentId: "agent-1",
      target: { kind: "last_turn" } as const,
      ignoreWhitespace: false,
      latestTurnDiffAt: "first",
      enabled: true,
      client: {
        async getAgentTurnDiff() {
          calls++;
          return payload;
        },
      },
    };
    try {
      await queryClient.fetchQuery(fetchQueryOptions(agentTurnDiffQueryOptions(input)));
      await queryClient.fetchQuery(
        fetchQueryOptions(agentTurnDiffQueryOptions({ ...input, latestTurnDiffAt: "second" })),
      );
      expect(calls).toBe(2);
    } finally {
      queryClient.clear();
    }
  });

  it.each([
    { ...payload, available: false },
    { ...payload, error: { code: "UNKNOWN", message: "Git failed" } },
  ])("retries an unsuccessful preload when the panel opens: $available, $error", async (failed) => {
    const queryClient = new QueryClient();
    const options = fetchQueryOptions(
      agentTurnDiffQueryOptions({
        serverId: "host",
        agentId: "agent-1",
        target: { kind: "turn", turnId: "turn-1" },
        ignoreWhitespace: false,
        latestTurnDiffAt: "first",
        enabled: true,
        client: {
          async getAgentTurnDiff() {
            return payload;
          },
        },
      }),
    );
    queryClient.setQueryData(options.queryKey, failed);
    const observer = new QueryObserver(queryClient, options);
    const settled = Promise.withResolvers<void>();
    const detach = observer.subscribe((result) => {
      if (result.fetchStatus === "idle") settled.resolve();
    });
    try {
      await settled.promise;
      expect(observer.getCurrentResult().data).toEqual(payload);
    } finally {
      detach();
      queryClient.clear();
    }
  });
});
