import { z } from "zod";
import {
  hashAccountKey,
  toneFromUsedPct,
  unavailable,
  usedPctOf,
  type UsageAccount,
  type UsageBalance,
  type UsageReport,
} from "@getpaseo/plugin/server/usage";
import type { UsageInput } from "../shared/input.js";
import { AuthMode, configPath, googleToken, readConfig, type Config } from "./config.js";

const amountSchema = z.number().finite().nonnegative();
const budgetSchema = z.object({
  max_budget: amountSchema.nullish(),
  budget_duration: z.string().nullish(),
  budget_reset_at: z.iso.datetime({ offset: true }).nullish(),
});
const spendingSchema = budgetSchema.extend({ spend: amountSchema });
const teamSchema = z.object({ team_id: z.string().min(1), team_alias: z.string().nullish() });
const userSchema = z.object({
  user_id: z.string().min(1),
  user_info: spendingSchema.extend({ user_email: z.string().nullish() }),
  teams: z.array(teamSchema).default([]),
});
const membershipSchema = z.object({
  user_id: z.string(),
  team_id: z.string(),
  spend: amountSchema,
  litellm_budget_table: budgetSchema.nullish(),
});
const teamResponseSchema = z.object({ team_memberships: z.array(membershipSchema) });
const keyResponseSchema = z.object({ info: spendingSchema });

// oxlint-disable-next-line typescript/consistent-type-definitions -- AGENTS.md requires type aliases.
type Dependencies = {
  fetchApi?: typeof fetch;
  getGoogleToken?: () => Promise<string>;
};
type Spending = z.infer<typeof spendingSchema>;

class LoginRejected extends Error {
  constructor(readonly status: number) {
    super(`LiteLLM usage access rejected (HTTP ${status})`);
  }
}

function client(config: Config, { fetchApi = fetch, getGoogleToken = googleToken }: Dependencies) {
  const token =
    config.authMode === AuthMode.Google ? getGoogleToken() : Promise.resolve(config.apiKey);
  return async function get(path: string): Promise<unknown> {
    const response = await fetchApi(`${config.baseUrl.replace(/\/$/, "")}${path}`, {
      headers: { Authorization: `Bearer ${await token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403)
      throw new LoginRejected(response.status);
    if (!response.ok) throw new Error(`LiteLLM usage API returned HTTP ${response.status}`);
    return response.json();
  };
}

function balance({
  id,
  label,
  spending,
}: {
  id: string;
  label: string;
  spending: Spending;
}): UsageBalance {
  const limit = spending.max_budget;
  const period = spending.budget_duration === "1mo" ? "Monthly " : "";
  return {
    id,
    label: `${period}${label}`,
    unit: "usd",
    used: spending.spend,
    limit,
    resetsAt: spending.budget_reset_at,
    tone: toneFromUsedPct(usedPctOf(spending.spend, limit)),
  };
}

export async function discover({
  path = configPath(),
  ...dependencies
}: Dependencies & { path?: string } = {}): Promise<UsageAccount[]> {
  const config = await readConfig(path);
  if (!config) return [];
  const get = client(config, dependencies);
  let user: z.infer<typeof userSchema>;
  try {
    user = userSchema.parse(await get("/user/info"));
  } catch {
    // Keep a card for configured logins even while access or discovery is failing.
    return [
      {
        key: hashAccountKey(path),
        input: { path, ...(config.teamId ? { teamId: config.teamId } : {}) },
      },
    ];
  }
  const teams = config.teamId
    ? [user.teams.find((team) => team.team_id === config.teamId) ?? { team_id: config.teamId }]
    : user.teams;
  const accounts = teams.length ? teams : [undefined];
  return accounts.map((team) => ({
    key: hashAccountKey(JSON.stringify([config.baseUrl, user.user_id, team?.team_id])),
    label: [user.user_info.user_email, team?.team_alias].filter(Boolean).join(" · ") || undefined,
    input: { path, ...(team ? { teamId: team.team_id } : {}) },
  }));
}

export async function fetchUsage(
  input: UsageInput,
  dependencies: Dependencies = {},
): Promise<UsageReport> {
  const config = await readConfig(input.path);
  if (!config) throw new Error("LiteLLM configuration no longer exists");
  const get = client(config, dependencies);
  try {
    const user = userSchema.parse(await get("/user/info"));
    const balances: UsageBalance[] = [];
    const teamId = input.teamId;
    if (teamId) {
      const team = teamResponseSchema.parse(
        await get(`/team/info?${new URLSearchParams({ team_id: teamId })}`),
      );
      const member = team.team_memberships.find(
        (membership) => membership.user_id === user.user_id && membership.team_id === teamId,
      );
      if (!member) throw new Error("LiteLLM user is no longer a member of the selected team");
      if (member.litellm_budget_table?.max_budget != null) {
        balances.push(
          balance({
            id: "team_member",
            label: "user budget",
            spending: { ...member.litellm_budget_table, spend: member.spend },
          }),
        );
      }
    }
    if (user.user_info.max_budget != null) {
      balances.push(balance({ id: "user", label: "personal budget", spending: user.user_info }));
    }
    if (config.authMode === AuthMode.VirtualKey) {
      const key = keyResponseSchema.parse(await get("/key/info"));
      if (key.info.max_budget != null)
        balances.push(balance({ id: "key", label: "key budget", spending: key.info }));
    }
    if (!balances.length)
      balances.push(balance({ id: "spending", label: "User spending", spending: user.user_info }));
    return {
      status: "available",
      windows: [],
      balances,
    };
  } catch (error) {
    if (error instanceof LoginRejected)
      return unavailable({ kind: "rejected", status: error.status });
    throw error;
  }
}
