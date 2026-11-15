import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { UsageSourceRegistration } from "@getpaseo/plugin/server/usage";
import { UsageSourceRegistry } from "../../../packages/server/src/server/plugins/usage-sources/index.js";
import { resolvePinnedUsage } from "../../../packages/app/src/usage/pinned.js";
import { DEFAULT_USAGE_PREFERENCES } from "../../../packages/app/src/usage/preferences.js";
import contribute from "../index.server.js";
import { probe } from "./internal/process.js";
import { discover, fetchUsage } from "./usage.js";

vi.mock("./internal/process.js", () => ({ probe: vi.fn() }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: vi.fn(),
}));

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "antigravity-usage-"));
  vi.mocked(homedir).mockReturnValue(home);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(probe).mockReset();
  await rm(home, { recursive: true, force: true });
});

async function login() {
  const directory = join(home, ".gemini", "antigravity-cli");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "jetski_state.pbtxt"), "fixture-state");
}

function quota() {
  return {
    status: "SUCCESS",
    command: {
      name: "usage",
      data: {
        groups: [
          {
            name: "Gemini Models",
            buckets: [
              {
                id: "gemini-weekly",
                name: "Weekly Limit Remaining",
                window: "weekly",
                remaining_fraction: 0.75,
                reset_time: "2026-11-22T05:17:46Z",
              },
              {
                id: "gemini-5h",
                name: "Five Hour Limit Remaining",
                window: "5h",
                remaining_fraction: 0,
              },
            ],
          },
          {
            name: "Claude and GPT models",
            buckets: [
              {
                id: "3p-weekly",
                name: "Weekly Limit Remaining",
                window: "weekly",
                remaining_fraction: 1,
              },
            ],
          },
          {
            name: "Gemini 4 Argon",
            buckets: [
              {
                id: "gemini-argon-wtu-weekly",
                name: "Gemini 4 Argon Weekly Limit",
                window: "weekly",
                remaining_fraction: 0.25,
              },
            ],
          },
        ],
      },
    },
  };
}

function registerSource(registry: UsageSourceRegistry) {
  const registerUsageSource = vi.fn((source: UsageSourceRegistration) => registry.register(source));
  contribute({
    registerProvider: vi.fn(),
    registerUsageSource,
    registerSettings() {
      throw new Error("Unexpected settings registration");
    },
    handle: vi.fn(),
    on: vi.fn(() => () => {}),
    before: vi.fn(() => () => {}),
  });
  return registerUsageSource;
}

test("discovers the local CLI state without starting an agent", async () => {
  expect(await discover()).toEqual([]);
  await login();
  const accounts = await discover();
  expect(accounts).toEqual([{ key: expect.stringMatching(/^[a-f0-9]{64}$/), input: {} }]);
  expect(probe).not.toHaveBeenCalled();
});

test("registers quota windows for the existing usage cards and sidebar", async () => {
  await login();
  vi.mocked(probe).mockResolvedValue(JSON.stringify(quota()));
  const registry = new UsageSourceRegistry();
  const registerUsageSource = registerSource(registry);
  expect(registerUsageSource).toHaveBeenCalledWith(
    expect.objectContaining({ id: "antigravity", icon: "icon.svg" }),
  );
  const reports = await registry.listReports();
  expect(reports[0]?.report).toMatchObject({
    status: "available",
    windows: [
      {
        id: "gemini-weekly",
        label: "Gemini Models · Weekly",
        usedPct: 25,
        remainingPct: 75,
        resetsAt: "2026-11-22T05:17:46Z",
        tone: "ok",
      },
      { id: "gemini-5h", usedPct: 100, remainingPct: 0, resetsAt: null, tone: "danger" },
      { id: "3p-weekly", usedPct: 0, remainingPct: 100 },
      { id: "gemini-argon-wtu-weekly", usedPct: 75, remainingPct: 25, tone: "warning" },
    ],
  });
  const sidebar = resolvePinnedUsage(reports, DEFAULT_USAGE_PREFERENCES);
  expect(sidebar[0]?.windows.map((window) => window.percent)).toEqual([25, 100, 0, 75]);
  expect(sidebar[0]?.windows.map((window) => window.shortLabel)).toEqual(["wk", "5h", "wk", "wk"]);
  expect(probe).toHaveBeenCalledWith({
    launch: { command: "agy", args: [], env: expect.any(Object) },
    args: ["-p", "/usage", "--output-format", "json"],
    cwd: home,
  });
  const reordered = quota();
  reordered.command.data.groups.reverse();
  vi.mocked(probe).mockResolvedValue(JSON.stringify(reordered));
  const refreshed = await registry.listReports({ forceRefresh: true });
  const pinned = resolvePinnedUsage(refreshed, {
    ...DEFAULT_USAGE_PREFERENCES,
    pins: [{ sourceId: "antigravity", windowId: "gemini-weekly" }],
  });
  expect(pinned[0]?.windows.map((window) => window.percent)).toEqual([25]);
});

test("reports an empty quota list as unavailable", async () => {
  vi.mocked(probe).mockResolvedValue(
    JSON.stringify({ status: "SUCCESS", command: { name: "usage", data: { groups: [] } } }),
  );
  expect(await fetchUsage()).toEqual({
    status: "unavailable",
    problem: { kind: "no_quota", detail: "No Antigravity quota reported" },
  });
});

test.each(["not json", JSON.stringify({ status: "ERROR" })])(
  "rejects invalid CLI output: %s",
  async (stdout) => {
    vi.mocked(probe).mockResolvedValue(stdout);
    await expect(fetchUsage()).rejects.toThrow();
  },
);

test("rejects invalid percentages instead of displaying a healthy quota", async () => {
  const response = quota();
  response.command.data.groups[0]!.buckets[0]!.remaining_fraction = 1.5;
  vi.mocked(probe).mockResolvedValue(JSON.stringify(response));
  await expect(fetchUsage()).rejects.toThrow();
});

test("surfaces CLI failures through the usage card", async () => {
  await login();
  vi.mocked(probe).mockRejectedValue(
    new Error("Antigravity authentication failed. Run `agy` and sign in, then retry."),
  );
  const registry = new UsageSourceRegistry();
  registerSource(registry);
  const reports = await registry.listReports();
  expect(reports[0]?.report).toEqual({
    status: "error",
    error: "Antigravity authentication failed. Run `agy` and sign in, then retry.",
  });
});
