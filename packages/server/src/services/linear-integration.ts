/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LRUCache } from "lru-cache";
import pLimit from "p-limit";
import { z } from "zod";
import type { Logger } from "pino";
import {
  LinearConnectionStatus,
  type LinearConnection,
  type LinearTicket,
} from "@getpaseo/protocol/messages";
import { parseLinearTicketUrl } from "@getpaseo/protocol/linear-tickets";
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
type StoredConnection = z.infer<typeof StoredConnectionSchema>;
type CachedIssue = { pending: Promise<LinearTicket | undefined>; expiresAt: number };

export type LinearIntegrationService = {
  getConnection(): Promise<LinearConnection>;
  setKey(apiKey: string): Promise<LinearConnection>;
  disconnect(): Promise<LinearConnection>;
  resolve(tickets?: readonly LinearTicket[]): Promise<LinearTicket[] | undefined>;
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
type IssueLookup = { ticket: LinearTicket; apiKey: string };

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
  async function loadIssue({ ticket, apiKey }: IssueLookup): Promise<LinearTicket | undefined> {
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
          variables: { id: ticket.identifier },
        }),
      );
      const issue = result.data.issue;
      // Identifiers are only unique within a Linear organization.
      if (!issue || parseLinearTicketUrl(issue.url)?.url !== ticket.url) return undefined;
      return {
        ...ticket,
        title: issue.title,
        state: issue.state,
        assignee: issue.assignee
          ? { name: issue.assignee.name, avatarUrl: issue.assignee.avatarUrl ?? undefined }
          : undefined,
        project: issue.project ?? undefined,
      };
    } catch {
      logger.warn({ identifier: ticket.identifier }, "Unable to load Linear issue metadata");
      return undefined;
    }
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
        return describe(next);
      });
    },
    disconnect() {
      return mutate(async () => {
        await rm(file, { force: true });
        stored = Promise.resolve(undefined);
        cache.clear();
        return describe(undefined);
      });
    },
    async resolve(tickets) {
      if (!tickets?.length) return tickets ? [...tickets] : undefined;
      let connection: StoredConnection | undefined;
      try {
        connection = await load();
      } catch {
        logger.warn("Unable to read Linear connection for issue metadata");
        return [...tickets];
      }
      if (!connection) return [...tickets];
      const { apiKey } = connection;
      return Promise.all(
        tickets.map(async (ticket) => {
          const normalized = parseLinearTicketUrl(ticket.url);
          if (!normalized) return ticket;
          let entry = cache.get(normalized.url);
          if (!entry || entry.expiresAt <= now()) {
            const pending = limitRequests(() => loadIssue({ ticket: normalized, apiKey }));
            entry = { pending, expiresAt: Number.POSITIVE_INFINITY };
            cache.set(normalized.url, entry);
            const current = entry;
            void pending.then((issue) => {
              current.expiresAt = now() + (issue ? 300_000 : 60_000);
              return undefined;
            });
          }
          const issue = await entry.pending;
          return issue ? { ...ticket, ...issue, title: ticket.title || issue.title } : ticket;
        }),
      );
    },
  };
}
