import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  hashAccountKey,
  toneFromUsedPct,
  unavailable,
  windowFromUsedPct,
  type UsageAccount,
  type UsageReport,
} from "@getpaseo/plugin/server/usage";
import { probe } from "./internal/process.js";

export const inputSchema = z.object({}).strict();

const usageSchema = z.object({
  status: z.literal("SUCCESS"),
  command: z.object({
    name: z.literal("usage"),
    data: z.object({
      groups: z.array(
        z.object({
          name: z.string().min(1),
          buckets: z.array(
            z.object({
              id: z.string().min(1),
              name: z.string().min(1),
              window: z.string().min(1),
              remaining_fraction: z.number().min(0).max(1),
              reset_time: z.iso.datetime({ offset: true }).optional(),
            }),
          ),
        }),
      ),
    }),
  }),
});

export async function discover(): Promise<UsageAccount[]> {
  const state = join(homedir(), ".gemini", "antigravity-cli", "jetski_state.pbtxt");
  return existsSync(state) ? [{ key: hashAccountKey(state), input: {} }] : [];
}

export async function fetchUsage(): Promise<UsageReport> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const stdout = await probe({
    launch: { command: "agy", args: [], env },
    args: ["-p", "/usage", "--output-format", "json"],
    cwd: homedir(),
  });
  const response = usageSchema.parse(JSON.parse(stdout));
  const windows = response.command.data.groups.flatMap((group) =>
    group.buckets.map((bucket) => {
      const usedPct = (1 - bucket.remaining_fraction) * 100;
      return windowFromUsedPct({
        id: bucket.id,
        label: `${group.name} · ${bucket.name.replace(/ Remaining$/, "")}`,
        shortLabel: `${group.name} ${bucket.window}`,
        summary: true,
        utilizationPct: usedPct,
        resetsAt: bucket.reset_time,
        tone: toneFromUsedPct(usedPct),
      });
    }),
  );
  if (!windows.length)
    return unavailable({ kind: "no_quota", detail: "No Antigravity quota reported" });
  return { status: "available", windows };
}
