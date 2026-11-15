import { z } from "zod";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";

const featureValuesSchema = z.record(z.string(), z.union([z.boolean(), z.string(), z.null()]));

export interface ProviderPreferences {
  model?: string;
  mode?: string;
  modeByHost?: Record<string, string>;
  thinkingByModel?: Record<string, string>;
  featureValues?: Record<string, unknown>;
}

export type LaunchTarget = { kind: "chat" } | { kind: "terminal"; profileId: string };

export interface FormPreferences {
  provider?: string;
  providerPreferences?: Record<string, ProviderPreferences>;
  favoriteModels?: Array<{ provider: string; modelId: string }>;
  isolation?: "local" | "worktree";
  isolationByProject?: Record<string, NonNullable<FormPreferences["isolation"]>>;
  launchTarget?: LaunchTarget;
}

const providerPreferencesSchema: z.ZodType<ProviderPreferences> = z.strictObject({
  model: z.string().optional(),
  mode: z.string().optional(),
  modeByHost: z.record(z.string(), z.string()).optional(),
  thinkingByModel: z.record(z.string(), z.string()).optional(),
  featureValues: featureValuesSchema.optional(),
});

const launchTargetSchema: z.ZodType<LaunchTarget> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("chat") }),
  z.strictObject({ kind: z.literal("terminal"), profileId: z.string() }),
]);

export const FormPreferencesSchema = z.strictObject({
  provider: z.string().optional(),
  providerPreferences: z.record(z.string(), providerPreferencesSchema).optional(),
  // COMPAT(agentProfileFavoriteMigration): favourites were removed in v0.3.2.
  // Keep the legacy payload alive until every capable host has had a chance to
  // import it; ordinary preference writes must not erase it first.
  favoriteModels: z
    .array(
      z.strictObject({
        provider: z.string(),
        modelId: z.string(),
      }),
    )
    .optional(),
  isolation: z.enum(["local", "worktree"]).optional(),
  isolationByProject: z.record(z.string(), z.enum(["local", "worktree"])).optional(),
  // What the New workspace composer submits to: the chat agent (default) or a
  // terminal profile. See `@/new-workspace-launch` for resolution/fallback.
  launchTarget: launchTargetSchema.optional(),
}) satisfies z.ZodType<FormPreferences>;

const LegacyProviderPreferencesSchema = z.strictObject({
  model: z.string().optional(),
  mode: z.string().optional(),
  thinkingOptionId: z.string().optional(),
});

const LegacyFormPreferencesSchema = z
  .strictObject({
    workingDir: z.string().optional(),
    provider: z.string().optional(),
    serverId: z.string().optional(),
    providerPreferences: z.record(z.string(), LegacyProviderPreferencesSchema).optional(),
  })
  .transform(({ provider, providerPreferences }): FormPreferences => {
    const migratedProviderPreferences: Record<string, ProviderPreferences> = {};
    for (const [providerId, legacy] of Object.entries(providerPreferences ?? {})) {
      const model = legacy.model;
      migratedProviderPreferences[providerId] = {
        ...(model !== undefined ? { model } : {}),
        ...(legacy.mode !== undefined ? { mode: legacy.mode } : {}),
        ...(model !== undefined && legacy.thinkingOptionId !== undefined
          ? { thinkingByModel: { [model]: legacy.thinkingOptionId } }
          : {}),
      };
    }
    return {
      ...(provider !== undefined ? { provider } : {}),
      ...(providerPreferences !== undefined
        ? { providerPreferences: migratedProviderPreferences }
        : {}),
    };
  });

export const StoredFormPreferencesSchema: z.ZodType<FormPreferences> = z.union([
  FormPreferencesSchema,
  LegacyFormPreferencesSchema,
]);

export const DEFAULT_FORM_PREFERENCES: FormPreferences = {};

export function parseFormPreferences(value: unknown): FormPreferences {
  const result = StoredFormPreferencesSchema.safeParse(value);
  return result.success ? result.data : DEFAULT_FORM_PREFERENCES;
}

function mergeDefinedRecord<T>(
  existing: Record<string, T> | undefined,
  updates: Record<string, T> | undefined,
): Record<string, T> | undefined {
  if (updates === undefined) {
    return existing;
  }
  return {
    ...existing,
    ...updates,
  };
}

export function resolveSavedModeId(
  providerPrefs: ProviderPreferences | undefined,
  serverId?: string | null,
): string | undefined {
  const normalizedServerId = serverId?.trim();
  if (normalizedServerId && providerPrefs?.modeByHost?.[normalizedServerId] !== undefined) {
    return providerPrefs.modeByHost[normalizedServerId];
  }
  return providerPrefs?.mode;
}

function applyProviderPreferenceUpdates(
  existing: ProviderPreferences,
  updates: Omit<Partial<ProviderPreferences>, "mode"> & { mode?: string | null },
  serverId?: string | null,
): ProviderPreferences {
  const next: ProviderPreferences = { ...existing };
  const nextThinkingByModel = mergeDefinedRecord(existing.thinkingByModel, updates.thinkingByModel);
  const nextFeatureValues = mergeDefinedRecord(existing.featureValues, updates.featureValues);
  const normalizedServerId = serverId?.trim();

  if (updates.model !== undefined) {
    next.model = updates.model;
  }
  if (updates.mode !== undefined) {
    if (normalizedServerId) {
      const nextModeByHost = { ...existing.modeByHost };
      if (updates.mode === null) {
        delete nextModeByHost[normalizedServerId];
      } else {
        nextModeByHost[normalizedServerId] = updates.mode;
      }
      if (Object.keys(nextModeByHost).length > 0) {
        next.modeByHost = nextModeByHost;
      } else {
        delete next.modeByHost;
      }
    } else if (updates.mode === null) {
      delete next.mode;
    } else {
      next.mode = updates.mode;
    }
  }
  if (nextThinkingByModel !== undefined) {
    next.thinkingByModel = nextThinkingByModel;
  }
  if (nextFeatureValues !== undefined) {
    next.featureValues = nextFeatureValues;
  }

  return next;
}

export function mergeProviderPreferences(args: {
  preferences: FormPreferences;
  provider: AgentProvider;
  serverId?: string | null;
  updates: Omit<Partial<ProviderPreferences>, "mode"> & { mode?: string | null };
}): FormPreferences {
  const { preferences, provider, serverId, updates } = args;
  const existingProviderPreferences = preferences.providerPreferences ?? {};
  const existing = existingProviderPreferences[provider] ?? {};

  return {
    ...preferences,
    provider,
    providerPreferences: {
      ...existingProviderPreferences,
      [provider]: applyProviderPreferenceUpdates(existing, updates, serverId),
    },
  };
}

export function mergeCreateAgentSelectionPreferences(args: {
  preferences: FormPreferences;
  provider: AgentProvider | null;
  serverId?: string | null;
  modelId?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  featureValues?: Record<string, unknown>;
}): FormPreferences {
  if (!args.provider) {
    return args.preferences;
  }

  const modelId = args.modelId?.trim() ?? "";
  const modeId = args.modeId?.trim() ?? "";
  const thinkingOptionId = args.thinkingOptionId?.trim() ?? "";
  const featureValues = featureValuesSchema.safeParse(args.featureValues);

  return mergeProviderPreferences({
    preferences: args.preferences,
    provider: args.provider,
    serverId: args.serverId,
    updates: {
      model: modelId || undefined,
      mode: args.modeId === undefined ? undefined : modeId || null,
      ...(modelId && thinkingOptionId ? { thinkingByModel: { [modelId]: thinkingOptionId } } : {}),
      ...(featureValues.success ? { featureValues: featureValues.data } : {}),
    },
  });
}

export function applyAgentProfilePreferences(args: {
  preferences: FormPreferences;
  previousProvider: AgentProvider | null;
  previousProviderModeIds: readonly string[];
  provider: AgentProvider;
  serverId?: string | null;
  modelId: string;
  modeId: string;
  thinkingOptionId: string;
  featureValues: Record<string, unknown>;
}): FormPreferences {
  let next = args.preferences;
  if (args.previousProvider) {
    const previousMode = resolveSavedModeId(
      next.providerPreferences?.[args.previousProvider],
      args.serverId,
    );
    if (previousMode && !args.previousProviderModeIds.includes(previousMode)) {
      next = mergeProviderPreferences({
        preferences: next,
        provider: args.previousProvider,
        serverId: args.serverId,
        updates: { mode: null },
      });
    }
  }

  return mergeProviderPreferences({
    preferences: next,
    provider: args.provider,
    serverId: args.serverId,
    updates: {
      model: args.modelId || undefined,
      mode: args.modeId || null,
      ...(args.modelId && args.thinkingOptionId
        ? { thinkingByModel: { [args.modelId]: args.thinkingOptionId } }
        : {}),
      featureValues: args.featureValues,
    },
  });
}
