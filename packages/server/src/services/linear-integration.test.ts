import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { LinearConnectionStatus } from "@getpaseo/protocol/messages";
import { createLinearIntegrationService } from "./linear-integration.js";

const homes: string[] = [];
const logger = { warn() {} };
const url = "https://linear.app/acme/issue/ENG-123";
const ticket = { identifier: "ENG-123", url };
const metadata = {
  state: { name: "In Progress", type: "started", color: "#e2b53e" },
  assignee: { name: "Alex Morgan", avatarUrl: "https://example.com/alex.png" },
  project: { name: "External Queries", color: "#ee6666" },
};
const connected = {
  status: LinearConnectionStatus.Connected,
  organizationName: "Acme",
};
async function home() {
  const directory = await mkdtemp(join(tmpdir(), "linear-integration-"));
  homes.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
function connectionResponse() {
  return Response.json({ data: { organization: { name: "Acme" } } });
}

test("validates a key, persists it privately, and returns only workspace metadata", async () => {
  const paseoHome = await home();
  const requests: RequestInit[] = [];
  const service = createLinearIntegrationService({
    paseoHome,
    logger,
    request: async (_url, init) => {
      if (init) requests.push(init);
      return connectionResponse();
    },
  });
  expect(await service.getConnection()).toEqual({ status: LinearConnectionStatus.Disconnected });
  expect(await service.setKey("  secret-key  ")).toEqual(connected);
  expect(requests[0].headers).toEqual({
    Authorization: "secret-key",
    "Content-Type": "application/json",
  });
  const file = join(paseoHome, "integrations", "linear.json");
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
    apiKey: "secret-key",
    organizationName: "Acme",
  });
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  const restarted = createLinearIntegrationService({
    paseoHome,
    logger,
    request: async () => {
      throw new Error("metadata must load from disk");
    },
  });
  expect(await restarted.getConnection()).toEqual(connected);
  const otherHost = createLinearIntegrationService({ paseoHome: await home(), logger });
  expect(await otherHost.getConnection()).toEqual({ status: LinearConnectionStatus.Disconnected });
});

test("rejected replacement keys preserve the saved connection", async () => {
  const service = createLinearIntegrationService({
    paseoHome: await home(),
    logger,
    request: async (_url, init) => {
      return new Headers(init?.headers).get("Authorization") === "good"
        ? connectionResponse()
        : new Response(null, { status: 401 });
    },
  });
  await service.setKey("good");
  await expect(service.setKey("bad")).rejects.toThrow("Linear rejected this API key");
  expect(await service.getConnection()).toEqual(connected);
});

test("enriches linked issues, deduplicates concurrent lookups, and keeps organizations distinct", async () => {
  let calls = 0;
  const service = createLinearIntegrationService({
    paseoHome: await home(),
    logger,
    request: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      calls += 1;
      if (!body.variables) return connectionResponse();
      expect(body.variables).toEqual({ id: "ENG-123" });
      return Response.json({
        data: { issue: { title: "Retry uploads", url: `${url}/retry-uploads`, ...metadata } },
      });
    },
  });
  await service.setKey("key");
  const titled = { ...ticket, title: "Retry uploads", ...metadata };
  expect(await Promise.all([service.resolve([ticket]), service.resolve([ticket])])).toEqual([
    [titled],
    [titled],
  ]);
  expect(calls).toBe(2);
  const other = { ...ticket, url: "https://linear.app/other/issue/ENG-123" };
  expect(await service.resolve([other])).toEqual([other]);
  expect(await service.resolve([{ ...ticket, title: "From PR" }])).toEqual([
    { ...ticket, title: "From PR", ...metadata },
  ]);
  expect(calls).toBe(3);
});

test("lookup errors preserve links and retry after the failure cache expires", async () => {
  let now = 0;
  let lookups = 0;
  const service = createLinearIntegrationService({
    paseoHome: await home(),
    logger,
    now: () => now,
    request: async (_url, init) => {
      if (!JSON.parse(String(init?.body)).variables) return connectionResponse();
      lookups += 1;
      if (lookups === 1) return Response.json({ errors: [{ message: "unavailable" }] });
      return Response.json({ data: { issue: { title: "Retry uploads", url, ...metadata } } });
    },
  });
  await service.setKey("key");
  expect(await service.resolve([ticket])).toEqual([ticket]);
  expect(await service.resolve([ticket])).toEqual([ticket]);
  expect(lookups).toBe(1);
  now = 60_001;
  expect(await service.resolve([ticket])).toEqual([
    { ...ticket, title: "Retry uploads", ...metadata },
  ]);
  expect(lookups).toBe(2);
});

test("replacement and disconnect clear cached metadata without restarting", async () => {
  let title = "First title";
  let calls = 0;
  const paseoHome = await home();
  const service = createLinearIntegrationService({
    paseoHome,
    logger,
    request: async (_url, init) => {
      calls += 1;
      if (!JSON.parse(String(init?.body)).variables) return connectionResponse();
      return Response.json({ data: { issue: { title, url, ...metadata } } });
    },
  });
  await service.setKey("first");
  expect(await service.resolve([ticket])).toEqual([{ ...ticket, title, ...metadata }]);
  title = "Second title";
  await service.setKey("second");
  expect(await service.resolve([ticket])).toEqual([{ ...ticket, title, ...metadata }]);
  expect(await service.disconnect()).toEqual({ status: LinearConnectionStatus.Disconnected });
  expect(await service.resolve([ticket])).toEqual([ticket]);
  expect(calls).toBe(4);
  await expect(readFile(join(paseoHome, "integrations", "linear.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test.each([401, 429, 503])(
  "failed connection requests never save credentials (HTTP %s)",
  async (status) => {
    const paseoHome = await home();
    const service = createLinearIntegrationService({
      paseoHome,
      logger,
      request: async () => new Response(null, { status }),
    });
    await expect(service.setKey("key")).rejects.toThrow();
    expect(await service.getConnection()).toEqual({ status: LinearConnectionStatus.Disconnected });
    await expect(readFile(join(paseoHome, "integrations", "linear.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

const pullRequestUrl = "https://github.com/acme/repo/pull/482";

test("PR issues require a Linear connection", async () => {
  let calls = 0;
  const service = createLinearIntegrationService({
    paseoHome: await home(),
    logger,
    request: async () => {
      calls += 1;
      return connectionResponse();
    },
  });
  expect(await service.getPullRequestTickets(pullRequestUrl)).toEqual([]);
  expect(await service.getPullRequestTickets()).toEqual([]);
  expect(calls).toBe(0);
});

test("loads all PR-linked issues with titles and caches concurrent lookups", async () => {
  let now = 0;
  const lookups: unknown[] = [];
  const second = {
    identifier: "ENG-124",
    url: "https://linear.app/acme/issue/ENG-124",
    title: "Cancel uploads",
  };
  const titled = { ...ticket, title: "Retry uploads" };
  const service = createLinearIntegrationService({
    paseoHome: await home(),
    logger,
    now: () => now,
    request: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.variables) return connectionResponse();
      expect(body.query).toContain("includeArchived: true");
      expect(new Headers(init?.headers).get("Authorization")).toBe("key");
      lookups.push(body.variables);
      const nextPage = body.variables.after === "next";
      return Response.json({
        data: {
          attachmentsForURL: {
            nodes: nextPage
              ? [{ issue: titled }, { issue: second }]
              : [{ issue: { ...titled, url: `${url}/retry-uploads` } }],
            pageInfo: { hasNextPage: !nextPage, endCursor: nextPage ? null : "next" },
          },
        },
      });
    },
  });
  await service.setKey("key");
  expect(
    await Promise.all([
      service.getPullRequestTickets(pullRequestUrl),
      service.getPullRequestTickets(pullRequestUrl),
    ]),
  ).toEqual([
    [titled, second],
    [titled, second],
  ]);
  expect(lookups).toEqual([{ url: pullRequestUrl }, { url: pullRequestUrl, after: "next" }]);
  expect(await service.getPullRequestTickets(pullRequestUrl)).toEqual([titled, second]);
  expect(lookups).toHaveLength(2);
  now = 300_001;
  expect(await service.getPullRequestTickets(pullRequestUrl)).toEqual([titled, second]);
  expect(lookups).toHaveLength(4);
});

test("PR lookup failures hide issues and retry after the failure cache expires", async () => {
  let now = 0;
  let lookups = 0;
  const service = createLinearIntegrationService({
    paseoHome: await home(),
    logger,
    now: () => now,
    request: async (_url, init) => {
      if (!JSON.parse(String(init?.body)).variables) return connectionResponse();
      lookups += 1;
      if (lookups === 1) return Response.json({ errors: [{ message: "unavailable" }] });
      return Response.json({
        data: {
          attachmentsForURL: {
            nodes: [{ issue: { ...ticket, title: "Retry uploads" } }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    },
  });
  await service.setKey("key");
  expect(await service.getPullRequestTickets(pullRequestUrl)).toEqual([]);
  expect(await service.getPullRequestTickets(pullRequestUrl)).toEqual([]);
  expect(lookups).toBe(1);
  now = 60_001;
  expect(await service.getPullRequestTickets(pullRequestUrl)).toEqual([
    { ...ticket, title: "Retry uploads" },
  ]);
  expect(lookups).toBe(2);
});

test("PR issues follow key replacement and disappear on disconnect", async () => {
  let lookups = 0;
  const service = createLinearIntegrationService({
    paseoHome: await home(),
    logger,
    request: async (_url, init) => {
      if (!JSON.parse(String(init?.body)).variables) return connectionResponse();
      lookups += 1;
      const title = new Headers(init?.headers).get("Authorization");
      return Response.json({
        data: {
          attachmentsForURL: {
            nodes: [{ issue: { ...ticket, title } }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    },
  });
  await service.setKey("first");
  expect(await service.getPullRequestTickets(pullRequestUrl)).toEqual([
    { ...ticket, title: "first" },
  ]);
  await service.setKey("second");
  expect(await service.getPullRequestTickets(pullRequestUrl)).toEqual([
    { ...ticket, title: "second" },
  ]);
  await service.disconnect();
  expect(await service.getPullRequestTickets(pullRequestUrl)).toEqual([]);
  expect(lookups).toBe(2);
});

test("disconnect discards PR issues from an in-flight lookup", async () => {
  const response = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const service = createLinearIntegrationService({
    paseoHome: await home(),
    logger,
    request: async (_url, init) => {
      if (!JSON.parse(String(init?.body)).variables) return connectionResponse();
      started.resolve();
      return response.promise;
    },
  });
  await service.setKey("key");
  const lookup = service.getPullRequestTickets(pullRequestUrl);
  await started.promise;
  await service.disconnect();
  response.resolve(
    Response.json({
      data: {
        attachmentsForURL: {
          nodes: [{ issue: { ...ticket, title: "Retry uploads" } }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    }),
  );
  expect(await lookup).toEqual([]);
});

test("incomplete PR attachment pagination never returns partial issues", async () => {
  let lookups = 0;
  const service = createLinearIntegrationService({
    paseoHome: await home(),
    logger,
    request: async (_url, init) => {
      if (!JSON.parse(String(init?.body)).variables) return connectionResponse();
      lookups += 1;
      return Response.json({
        data: {
          attachmentsForURL: {
            nodes: [{ issue: { ...ticket, title: "Retry uploads" } }],
            pageInfo: { hasNextPage: true, endCursor: "stuck" },
          },
        },
      });
    },
  });
  await service.setKey("key");
  expect(await service.getPullRequestTickets(pullRequestUrl)).toEqual([]);
  expect(lookups).toBe(2);
});

test("refreshes metadata on titled issues and clears removed assignees and projects", async () => {
  let now = 0;
  let lookups = 0;
  const service = createLinearIntegrationService({
    paseoHome: await home(),
    logger,
    now: () => now,
    request: async (_url, init) => {
      if (!JSON.parse(String(init?.body)).variables) return connectionResponse();
      lookups += 1;
      const issue = { title: "Retry uploads", url, ...metadata };
      if (lookups === 1) return Response.json({ data: { issue } });
      return Response.json({ data: { issue: { ...issue, assignee: null, project: null } } });
    },
  });
  await service.setKey("key");
  const resolved = await service.resolve([{ ...ticket, title: "From PR" }]);
  expect(resolved).toEqual([{ ...ticket, title: "From PR", ...metadata }]);
  expect(await service.resolve(resolved)).toEqual(resolved);
  expect(lookups).toBe(1);
  now = 300_001;
  expect(await service.resolve(resolved)).toEqual([
    { ...ticket, title: "From PR", state: metadata.state, assignee: undefined, project: undefined },
  ]);
  expect(lookups).toBe(2);
});

test("keeps an assigned user's name when Linear has no avatar photo", async () => {
  const service = createLinearIntegrationService({
    paseoHome: await home(),
    logger,
    request: async (_url, init) => {
      if (!JSON.parse(String(init?.body)).variables) return connectionResponse();
      return Response.json({
        data: {
          issue: {
            title: "Retry uploads",
            url,
            ...metadata,
            assignee: { name: "Alex Morgan", avatarUrl: null },
          },
        },
      });
    },
  });
  await service.setKey("key");
  expect(await service.resolve([ticket])).toEqual([
    {
      ...ticket,
      title: "Retry uploads",
      ...metadata,
      assignee: { name: "Alex Morgan", avatarUrl: undefined },
    },
  ]);
});
