import { describe, expect, it } from "vitest";
import {
  type AgentHistorySearchCandidate,
  createAgentHistorySearch,
} from "./agent-history-search.js";

function matchesAgentHistoryQuery(query: string, entry: AgentHistorySearchCandidate): boolean {
  return createAgentHistorySearch({ query })(entry);
}

function candidate(input: {
  title?: string | null;
  workspaceName?: string | null;
  branch?: string | null;
  projectName?: string;
  updatedAt?: string;
}): AgentHistorySearchCandidate & { agent: { id: string; updatedAt: string } } {
  const branch = input.branch ?? null;
  return {
    agent: {
      id: input.title ?? "agent",
      title: input.title ?? null,
      updatedAt: input.updatedAt ?? "2026-08-07T00:00:00.000Z",
    },
    project: {
      projectKey: "key",
      projectName: input.projectName ?? "getpaseo/paseo",
      workspaceName: input.workspaceName ?? null,
      checkout: {
        cwd: "/tmp/repo",
        isGit: branch !== null,
        currentBranch: branch,
        remoteUrl: null,
        worktreeRoot: "/tmp/repo",
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
    // The module only reads the four names; the rest of the payload is the
    // session's business.
  } as unknown as AgentHistorySearchCandidate & { agent: { id: string; updatedAt: string } };
}

describe("matchesAgentHistoryQuery", () => {
  it("matches current workspace PR numbers, prefixed IDs, titles, and URLs", () => {
    const workspacePullRequest = {
      url: "https://github.com/acme/repo/pull/482",
      number: 482,
      title: "Retry uploads",
      state: "open",
      isMerged: false,
      forge: "github",
    };
    const entry = { ...candidate({ title: "Work" }), workspacePullRequest };
    for (const query of ["482", "#482", "uploads", workspacePullRequest.url])
      expect(matchesAgentHistoryQuery(query, entry)).toBe(true);
    expect(matchesAgentHistoryQuery("#999", entry)).toBe(false);
    expect(matchesAgentHistoryQuery("#482", { ...entry, workspacePullRequest: null })).toBe(false);
    expect(
      matchesAgentHistoryQuery("!482", {
        ...entry,
        workspacePullRequest: { ...workspacePullRequest, forge: "gitlab" },
      }),
    ).toBe(true);
    expect(
      matchesAgentHistoryQuery("#482", {
        ...entry,
        workspacePullRequest: { ...workspacePullRequest, number: undefined },
      }),
    ).toBe(true);
  });
  it("matches workspace issue identifiers and available titles", () => {
    const entry = {
      ...candidate({ title: "Work" }),
      workspaceLinearTickets: [
        {
          identifier: "ENG-123",
          url: "https://linear.app/acme/issue/ENG-123",
          title: "Retry uploads",
        },
      ],
    };
    expect(matchesAgentHistoryQuery("eng-123", entry)).toBe(true);
    expect(matchesAgentHistoryQuery("uploads", entry)).toBe(true);
    expect(matchesAgentHistoryQuery("ENG-999", entry)).toBe(false);
  });
  it("rejects scattered letters across words while keeping within-word subsequences", () => {
    expect(
      matchesAgentHistoryQuery(
        "terminal",
        candidate({
          title: "Let me diagnose this problem in a diagnose this problem and",
        }),
      ),
    ).toBe(false);
    expect(matchesAgentHistoryQuery("trmnl", candidate({ title: "Fix terminal resizing" }))).toBe(
      true,
    );
  });

  it("matches the workspace name", () => {
    expect(
      matchesAgentHistoryQuery("stripe", candidate({ workspaceName: "Add Stripe billing" })),
    ).toBe(true);
  });

  it("matches the agent title", () => {
    expect(
      matchesAgentHistoryQuery("entitlements", candidate({ title: "Reshape entitlements" })),
    ).toBe(true);
  });

  it("matches the branch name", () => {
    expect(matchesAgentHistoryQuery("billing", candidate({ branch: "add-stripe-billing" }))).toBe(
      true,
    );
  });

  it("matches the project name", () => {
    expect(matchesAgentHistoryQuery("paseo", candidate({ projectName: "getpaseo/paseo" }))).toBe(
      true,
    );
  });

  it("requires every token to match somewhere", () => {
    const entry = candidate({ workspaceName: "Add Stripe billing", branch: "main" });
    expect(matchesAgentHistoryQuery("stripe main", entry)).toBe(true);
    expect(matchesAgentHistoryQuery("stripe rosetta", entry)).toBe(false);
  });

  it("tolerates a typo", () => {
    expect(
      matchesAgentHistoryQuery("bulling", candidate({ workspaceName: "Add Stripe billing" })),
    ).toBe(true);
  });

  it("tolerates a transposed branch name", () => {
    expect(matchesAgentHistoryQuery("mian", candidate({ branch: "main" }))).toBe(true);
    expect(matchesAgentHistoryQuery("rain", candidate({ branch: "main" }))).toBe(false);
  });

  it("applies options to all four metadata fields", () => {
    const search = createAgentHistorySearch({
      query: "^Bill$",
      options: { regex: true, caseSensitive: true },
    });
    for (const field of ["title", "workspaceName", "branch", "projectName"] as const) {
      expect(search(candidate({ [field]: "Bill" }))).toBe(true);
      expect(search(candidate({ [field]: "bill" }))).toBe(false);
    }
    expect(
      createAgentHistorySearch({ query: "bill", options: { wholeWord: true } })(
        candidate({ title: "billing" }),
      ),
    ).toBe(false);
  });
  it("keeps candidates for a blank query", () => {
    expect(matchesAgentHistoryQuery("   ", candidate({ title: "anything" }))).toBe(true);
  });
});
