import { z } from "zod";
import { AgentHistoryFilterOptionsSchema } from "@getpaseo/protocol/messages";

export enum HistoryStatus {
  All = "all",
  None = "none",
  Active = "active",
  Archived = "archived",
}

export enum HistoryAgentType {
  All = "all",
  None = "none",
  Main = "main",
  Subagent = "subagent",
}

export enum HistoryField {
  Subagent = "subagent",
  Project = "project",
  Workspace = "workspace",
  Branch = "branch",
  Host = "host",
  Provider = "provider",
  Model = "model",
  Effort = "effort",
  Turns = "turns",
  Cost = "cost",
  Status = "status",
  LastActivity = "lastActivity",
}

const HistoryFieldsSchema = z.object({
  subagent: z.boolean().catch(true),
  project: z.boolean().catch(true),
  workspace: z.boolean().catch(true),
  branch: z.boolean().catch(true),
  host: z.boolean().catch(true),
  provider: z.boolean().catch(true),
  model: z.boolean().catch(true),
  effort: z.boolean().catch(true),
  turns: z.boolean().catch(true),
  cost: z.boolean().catch(true),
  status: z.boolean().catch(true),
  lastActivity: z.boolean().catch(true),
});

const HistoryFiltersSchema = z.object({
  agentType: z.enum(HistoryAgentType).catch(HistoryAgentType.All),
  hosts: z.array(z.string()).nullable().catch([]),
  projects: z.array(z.string()).nullable().catch([]),
  providers: z.array(z.string()).nullable().catch([]),
  models: AgentHistoryFilterOptionsSchema.shape.models.nullable().catch([]),
  status: z.enum(HistoryStatus).catch(HistoryStatus.All),
});

export type HistoryFields = z.infer<typeof HistoryFieldsSchema>;
export type HistoryFilters = z.infer<typeof HistoryFiltersSchema>;
export const EMPTY_HISTORY_FILTERS = HistoryFiltersSchema.parse({});
export const DEFAULT_HISTORY_FIELDS = HistoryFieldsSchema.parse({});
const RECENT_SEARCH_LIMIT = 100;

export const HistoryPreferencesSchema = z.object({
  fields: HistoryFieldsSchema.catch(DEFAULT_HISTORY_FIELDS),
  filters: HistoryFiltersSchema.catch(EMPTY_HISTORY_FILTERS),
  recentSearches: z.array(z.string().min(1)).max(RECENT_SEARCH_LIMIT).catch([]),
});

export type HistoryPreferences = z.infer<typeof HistoryPreferencesSchema>;
export const DEFAULT_HISTORY_PREFERENCES = HistoryPreferencesSchema.parse({});

export function addRecentHistorySearch({
  searches,
  query,
}: {
  searches: string[];
  query: string;
}): string[] {
  const trimmed = query.trim();
  if (!trimmed || searches[0] === trimmed) return searches;
  return [trimmed, ...searches.filter((search) => search !== trimmed)].slice(
    0,
    RECENT_SEARCH_LIMIT,
  );
}
