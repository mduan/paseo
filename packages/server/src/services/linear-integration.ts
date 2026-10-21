/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LRUCache } from "lru-cache";
import pLimit from "p-limit";
import { z } from "zod";
import type { Logger } from "pino";
import {
  LinearConnectionStatus,
  LinearIssueSchema,
  type LinearConnection,
  type LinearIssue,
} from "@getpaseo/protocol/messages";
import { parseLinearIssueUrl } from "@getpaseo/protocol/linear-issues";
import { writeFileAtomic } from "../server/atomic-file.js";

const StoredConnectionSchema = z.object({
  apiKey: z.string().min(1),
  organizationName: z.string(),
});
const GraphqlErrorsSchema = z.object({ errors: z.array(z.unknown()).optional() });
const ConnectionResponseSchema = z.object({
  data: z.object({
    organization: z.object({ name: z.string() }),
  }),
});
const IssueResponseSchema = z.object({
  data: z.object({
    issue: z
      .object({
        title: z.string().min(1),
        url: z.string(),
        state: z.object({ name: z.string(), type: z.string(), color: z.string() }),
        assignee: z.object({ name: z.string(), avatarUrl: z.string().nullable() }).nullable(),
        project: z.object({ name: z.string(), color: z.string() }).nullable(),
      })
      .nullable(),
  }),
});
const AttachmentsResponseSchema = z.object({
  data: z.object({
    attachmentsForURL: z.object({
      nodes: z.array(
        z.object({
          issue: LinearIssueSchema.pick({ identifier: true, title: true, url: true }).required(),
        }),
      ),
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    }),
  }),
});
type StoredConnection = z.infer<typeof StoredConnectionSchema>;
type CachedIssue = { pending: Promise<LinearIssue | undefined>; expiresAt: number };
type CachedPullRequestIssues = { pending: Promise<LinearIssue[]>; expiresAt: number };

export type LinearIntegrationService = {
  getConnection(): Promise<LinearConnection>;
  setKey(apiKey: string): Promise<LinearConnection>;
  disconnect(): Promise<LinearConnection>;
  getPullRequestIssues(url?: string): Promise<LinearIssue[]>;
  resolve(issues?: readonly LinearIssue[]): Promise<LinearIssue[] | undefined>;
};
type Options = {
  paseoHome: string;
  logger: Pick<Logger, "warn">;
  request?: typeof fetch;
  now?: () => number;
};
type GraphqlRequest = {
  apiKey: string;
  query: string;
  variables?: Record<string, string>;
};
type IssueLookup = { issue: LinearIssue; apiKey: string };
type PullRequestLookup = { url: string; apiKey: string };

class LinearIntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearIntegrationError";
  }
}

export function createLinearIntegrationService({
  paseoHome,
  logger,
  request = fetch,
  now = Date.now,
}: Options): LinearIntegrationService {
  const file = join(paseoHome, "integrations", "linear.json");
  const cache = new LRUCache<string, CachedIssue>({ max: 256 });
  const pullRequestCache = new LRUCache<string, CachedPullRequestIssues>({ max: 256 });
  const limitRequests = pLimit(4);
  const mutate = pLimit(1);
  let stored: Promise<StoredConnection | undefined> | undefined;

  async function readConnection(): Promise<StoredConnection | undefined> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw new LinearIntegrationError("Unable to read the saved Linear connection.");
    }
    try {
      return StoredConnectionSchema.parse(JSON.parse(raw));
    } catch {
      throw new LinearIntegrationError(
        "Unable to read the saved Linear connection. Replace the key or disconnect.",
      );
    }
  }
  async function load(): Promise<StoredConnection | undefined> {
    const pending = (stored ??= readConnection());
    try {
      return await pending;
    } catch (error) {
      if (stored === pending) stored = undefined;
      throw error;
    }
  }
  function describe(connection: StoredConnection | undefined): LinearConnection {
    if (!connection) return { status: LinearConnectionStatus.Disconnected };
    return {
      status: LinearConnectionStatus.Connected,
      organizationName: connection.organizationName,
    };
  }
  async function graphql({ apiKey, query, variables }: GraphqlRequest): Promise<unknown> {
    try {
      const response = await request("https://api.linear.app/graphql", {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 401 || response.status === 403)
        throw new LinearIntegrationError(
          "Linear rejected this API key. Check its access and try again.",
        );
      if (response.status === 429)
        throw new LinearIntegrationError("Linear rate limit reached. Try again shortly.");
      if (!response.ok) throw new LinearIntegrationError("Linear is unavailable. Try again.");
      const body: unknown = await response.json();
      if (GraphqlErrorsSchema.parse(body).errors?.length)
        throw new LinearIntegrationError(
          "Linear could not complete the request. Check the key's access and try again.",
        );
      return body;
    } catch (error) {
      if (error instanceof LinearIntegrationError) throw error;
      throw new LinearIntegrationError("Could not reach Linear. Try again.");
    }
  }
  async function loadIssue({ issue, apiKey }: IssueLookup): Promise<LinearIssue | undefined> {
    try {
      const result = IssueResponseSchema.parse(
        await graphql({
          apiKey,
          query: `query PaseoIssue($id: String!) {
            issue(id: $id) {
              title url
              state { name type color }
              assignee { name avatarUrl }
              project { name color }
            }
          }`,
          variables: { id: issue.identifier },
        }),
      );
      const details = result.data.issue;
      // Identifiers are only unique within a Linear organization.
      if (!details || parseLinearIssueUrl(details.url)?.url !== issue.url) return undefined;
      return {
        ...issue,
        title: details.title,
        state: details.state,
        assignee: details.assignee
          ? { name: details.assignee.name, avatarUrl: details.assignee.avatarUrl ?? undefined }
          : undefined,
        project: details.project ?? undefined,
      };
    } catch {
      logger.warn({ identifier: issue.identifier }, "Unable to load Linear issue metadata");
      return undefined;
    }
  }

  async function loadPullRequestIssues({ url, apiKey }: PullRequestLookup): Promise<LinearIssue[]> {
    const issues = new Map<string, LinearIssue>();
    let after: string | undefined;
    do {
      const response = AttachmentsResponseSchema.parse(
        await graphql({
          apiKey,
          query: `query PaseoPullRequestIssues($url: String!, $after: String) {
            attachmentsForURL(url: $url, after: $after, first: 100, includeArchived: true) {
              nodes { issue { identifier title url } }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          variables: { url, ...(after ? { after } : {}) },
        }),
      );
      const page = response.data.attachmentsForURL;
      for (const { issue } of page.nodes) {
        const normalized = parseLinearIssueUrl(issue.url);
        if (normalized) issues.set(normalized.url, { ...normalized, title: issue.title });
      }
      if (!page.pageInfo.hasNextPage) break;
      const cursor = page.pageInfo.endCursor;
      if (!cursor || cursor === after) {
        throw new LinearIntegrationError("Linear attachment pagination did not advance.");
      }
      after = cursor;
    } while (after);
    return [...issues.values()];
  }

  return {
    async getConnection() {
      return describe(await load());
    },
    setKey(value) {
      return mutate(async () => {
        const apiKey = value.trim();
        if (!apiKey || apiKey.length > 4096)
          throw new LinearIntegrationError("Enter a Linear API key.");
        const response = ConnectionResponseSchema.safeParse(
          await graphql({
            apiKey,
            query: "query PaseoLinearConnection { organization { name } }",
          }),
        );
        if (!response.success)
          throw new LinearIntegrationError(
            "Linear returned an invalid connection response. Try again.",
          );
        const next = {
          apiKey,
          organizationName: response.data.data.organization.name,
        };
        await writeFileAtomic(file, JSON.stringify(next), { mode: 0o600 });
        stored = Promise.resolve(next);
        cache.clear();
        pullRequestCache.clear();
        return describe(next);
      });
    },
    disconnect() {
      return mutate(async () => {
        await rm(file, { force: true });
        stored = Promise.resolve(undefined);
        cache.clear();
        pullRequestCache.clear();
        return describe(undefined);
      });
    },
    async getPullRequestIssues(url) {
      if (!url) return [];
      try {
        const connection = await load();
        if (!connection) return [];
        let entry = pullRequestCache.get(url);
        if (!entry || entry.expiresAt <= now()) {
          const pending = limitRequests(() =>
            loadPullRequestIssues({ url, apiKey: connection.apiKey }),
          );
          entry = { pending, expiresAt: Number.POSITIVE_INFINITY };
          const current = entry;
          current.pending = pending.then(
            (issues) => {
              current.expiresAt = now() + 300_000;
              return issues;
            },
            () => {
              current.expiresAt = now() + 60_000;
              logger.warn({ url }, "Unable to load Linear issues for pull request");
              return [];
            },
          );
          pullRequestCache.set(url, current);
        }
        const issues = await entry.pending;
        return (await load()) === connection ? issues : [];
      } catch {
        logger.warn("Unable to read Linear connection for pull request issues");
        return [];
      }
    },
    async resolve(issues) {
      if (!issues?.length) return issues ? [...issues] : undefined;
      let connection: StoredConnection | undefined;
      try {
        connection = await load();
      } catch {
        logger.warn("Unable to read Linear connection for issue metadata");
        return [...issues];
      }
      if (!connection) return [...issues];
      const { apiKey } = connection;
      return Promise.all(
        issues.map(async (issue) => {
          const normalized = parseLinearIssueUrl(issue.url);
          if (!normalized) return issue;
          let entry = cache.get(normalized.url);
          if (!entry || entry.expiresAt <= now()) {
            const pending = limitRequests(() => loadIssue({ issue: normalized, apiKey }));
            entry = { pending, expiresAt: Number.POSITIVE_INFINITY };
            cache.set(normalized.url, entry);
            const current = entry;
            void pending.then((details) => {
              current.expiresAt = now() + (details ? 300_000 : 60_000);
              return undefined;
            });
          }
          const resolvedIssue = await entry.pending;
          return resolvedIssue
            ? { ...issue, ...resolvedIssue, title: issue.title || resolvedIssue.title }
            : issue;
        }),
      );
    },
  };
}
