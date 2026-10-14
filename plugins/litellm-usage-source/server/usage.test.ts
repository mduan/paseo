import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthMode, configPath, readConfig } from "./config.js";
import { discover, fetchUsage } from "./usage.js";

const baseUrl = "https://gateway.example";
const user = {
  user_id: "user-1",
  user_info: { spend: 16.17, max_budget: null, user_email: "user@example.com" },
  teams: [{ team_id: "team-1", team_alias: "Engineering" }],
};
const membership = {
  user_id: "user-1",
  team_id: "team-1",
  spend: 16.17,
  total_spend: 1234,
  litellm_budget_table: {
    max_budget: 3000,
    budget_duration: "1mo",
    budget_reset_at: "2026-11-01T00:00:00Z",
  },
};

describe("LiteLLM usage source", () => {
  let directory: string;
  let path: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "litellm-usage-"));
    path = join(directory, "litellm-proxy.json");
    await writeConfig();
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function writeConfig(overrides: Record<string, unknown> = {}) {
    await writeFile(
      path,
      JSON.stringify({ baseUrl, authMode: AuthMode.VirtualKey, apiKey: "test-key", ...overrides }),
    );
  }

  function api(overrides: Record<string, unknown> = {}) {
    const responses: Record<string, unknown> = {
      "/user/info": user,
      "/team/info?team_id=team-1": { team_memberships: [membership] },
      "/key/info": { info: { spend: 0, max_budget: null } },
      ...overrides,
    };
    return vi.fn<typeof fetch>(async (url) => {
      const endpoint = String(url).slice(baseUrl.length);
      if (!(endpoint in responses)) throw new Error(`Unexpected endpoint: ${endpoint}`);
      const response = responses[endpoint];
      return response instanceof Response ? response.clone() : Response.json(response);
    });
  }

  it("discovers accounts and uses membership period spending instead of lifetime or team spending", async () => {
    const fetchApi = api();
    const accounts = await discover({ path, fetchApi });
    expect(accounts).toEqual([
      {
        key: expect.stringMatching(/^[a-f0-9]{64}$/),
        label: "user@example.com · Engineering",
        input: { path, teamId: "team-1" },
      },
    ]);
    const report = await fetchUsage({ path, teamId: "team-1" }, { fetchApi });
    expect(report).toMatchObject({
      status: "available",
      windows: [],
      balances: [
        {
          id: "team_member",
          label: "Monthly user budget",
          used: 16.17,
          limit: 3000,
          unit: "usd",
          resetsAt: "2026-11-01T00:00:00Z",
        },
      ],
    });
    expect(report).not.toHaveProperty("details");
    expect(JSON.stringify(accounts)).not.toContain("test-key");
  });

  it("refuses redirects instead of forwarding credentials to another route", async () => {
    let forwarded = false;
    const server = createServer((request, response) => {
      if (request.url === "/collect") forwarded = true;
      response.writeHead(302, { Location: "/collect" }).end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      await writeConfig({ baseUrl: `http://127.0.0.1:${address.port}` });
      await expect(fetchUsage({ path })).rejects.toThrow();
      expect(forwarded).toBe(false);
    } finally {
      await promisify(server.close.bind(server))();
    }
  });

  it("re-reads rotated keys and keeps account identity stable", async () => {
    const fetchApi = api();
    const first = await discover({ path, fetchApi });
    await writeConfig({ apiKey: "rotated-key" });
    expect(await discover({ path, fetchApi })).toEqual(first);
    await fetchUsage({ path, teamId: "team-1" }, { fetchApi });
    expect(fetchApi).toHaveBeenLastCalledWith(
      `${baseUrl}/key/info`,
      expect.objectContaining({
        headers: { Authorization: "Bearer rotated-key", Accept: "application/json" },
      }),
    );
  });

  it("uses Google identity without requiring a virtual key", async () => {
    await writeFile(path, JSON.stringify({ baseUrl, authMode: AuthMode.Google }));
    const getGoogleToken = vi.fn(async () => "google-token");
    const fetchApi = api();
    const report = await fetchUsage({ path, teamId: "team-1" }, { fetchApi, getGoogleToken });
    expect(report).toMatchObject({ status: "available", balances: [{ used: 16.17, limit: 3000 }] });
    expect(getGoogleToken).toHaveBeenCalledTimes(1);
    expect(fetchApi).toHaveBeenCalledTimes(2);
    expect(fetchApi).toHaveBeenCalledWith(
      `${baseUrl}/user/info`,
      expect.objectContaining({
        headers: { Authorization: "Bearer google-token", Accept: "application/json" },
      }),
    );
  });

  it("discovers separate memberships and respects an explicit team selection", async () => {
    const fetchApi = api({
      "/user/info": { ...user, teams: [...user.teams, { team_id: "team-2", team_alias: "Other" }] },
    });
    const all = await discover({ path, fetchApi });
    expect(all).toHaveLength(2);
    expect(all[0]?.key).not.toBe(all[1]?.key);
    await writeConfig({ teamId: "team-2" });
    expect(await discover({ path, fetchApi })).toEqual([all[1]]);
  });

  it("shows personal and key limits separately, including an exhausted zero budget", async () => {
    const fetchApi = api({
      "/user/info": { ...user, user_info: { ...user.user_info, max_budget: 1500 } },
      "/key/info": { info: { spend: 2, max_budget: 0 } },
    });
    const report = await fetchUsage({ path, teamId: "team-1" }, { fetchApi });
    expect(report).toMatchObject({
      status: "available",
      balances: [
        { id: "team_member", limit: 3000 },
        { id: "user", limit: 1500 },
        { id: "key", limit: 0, used: 2 },
      ],
    });
  });

  it("reports uncapped spending without inventing a monthly budget or reset", async () => {
    const fetchApi = api({ "/user/info": { ...user, teams: [] } });
    const report = await fetchUsage({ path }, { fetchApi });
    expect(report).toMatchObject({
      status: "available",
      balances: [{ id: "spending", label: "User spending", used: 16.17 }],
    });
    if (report.status !== "available") throw new Error("Expected usage");
    expect(report.balances?.[0]?.limit).toBeNull();
    expect(report.balances?.[0]?.resetsAt).toBeUndefined();
  });

  it("keeps rejected logins visible and reports access errors", async () => {
    const fetchApi = api({
      "/user/info": new Response("credential must not leak", { status: 403 }),
    });
    expect(await discover({ path, fetchApi })).toHaveLength(1);
    expect(await fetchUsage({ path }, { fetchApi })).toEqual({
      status: "unavailable",
      problem: { kind: "rejected", status: 403 },
    });
  });

  it("refuses to substitute a team total when the user's membership is absent", async () => {
    const fetchApi = api({
      "/team/info?team_id=team-1": {
        team_memberships: [{ ...membership, user_id: "somebody-else" }],
      },
    });
    await expect(fetchUsage({ path, teamId: "team-1" }, { fetchApi })).rejects.toThrow(
      "no longer a member",
    );
  });

  it("validates API responses and surfaces network and Google login failures", async () => {
    await expect(
      fetchUsage(
        { path },
        { fetchApi: api({ "/user/info": { ...user, user_info: { spend: "invalid" } } }) },
      ),
    ).rejects.toThrow();
    await expect(
      fetchUsage(
        { path },
        { fetchApi: api({ "/user/info": new Response("private error", { status: 500 }) }) },
      ),
    ).rejects.toThrow("HTTP 500");
    await writeConfig({ authMode: AuthMode.Google });
    await expect(
      fetchUsage(
        { path },
        {
          getGoogleToken: async () => {
            throw new Error("Google login expired");
          },
        },
      ),
    ).rejects.toThrow("Google login expired");
  });

  it("skips absent config and never includes config credentials in validation errors", async () => {
    await rm(path);
    expect(await discover({ path })).toEqual([]);
    await writeConfig({ baseUrl: "https://test-key@gateway.example" });
    await expect(readConfig(path)).rejects.toThrow("Invalid LiteLLM configuration");
  });

  it("resolves the default, Pi directory, and explicit config path without changing the environment", () => {
    expect(configPath({ home: directory, env: {} })).toBe(
      join(directory, ".pi/agent/litellm-proxy.json"),
    );
    expect(configPath({ home: directory, env: { PI_CODING_AGENT_DIR: "~/custom" } })).toBe(
      join(directory, "custom/litellm-proxy.json"),
    );
    expect(
      configPath({
        home: directory,
        env: { PI_CODING_AGENT_DIR: "/ignored", LITELLM_CONFIG_PATH: "~/gateway.json" },
      }),
    ).toBe(join(directory, "gateway.json"));
  });
});
