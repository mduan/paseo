import { z } from "zod";
import { AgentHistoryFilterOptionsSchema } from "@getpaseo/protocol/messages";

export enum HistoryStatus {
  All = "all",
  Active = "active",
  Archived = "archived",
}

export enum HistoryField {
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
  hosts: z.array(z.string()).catch([]),
  projects: z.array(z.string()).catch([]),
  providers: z.array(z.string()).catch([]),
  models: AgentHistoryFilterOptionsSchema.shape.models.catch([]),
  status: z.enum(HistoryStatus).catch(HistoryStatus.All),
});

export type HistoryFields = z.infer<typeof HistoryFieldsSchema>;
export type HistoryFilters = z.infer<typeof HistoryFiltersSchema>;
export const EMPTY_HISTORY_FILTERS = HistoryFiltersSchema.parse({});
export const DEFAULT_HISTORY_FIELDS = HistoryFieldsSchema.parse({});

export const HistoryPreferencesSchema = z.object({
  fields: HistoryFieldsSchema.catch(DEFAULT_HISTORY_FIELDS),
  filters: HistoryFiltersSchema.catch(EMPTY_HISTORY_FILTERS),
});

export type HistoryPreferences = z.infer<typeof HistoryPreferencesSchema>;
export const DEFAULT_HISTORY_PREFERENCES = HistoryPreferencesSchema.parse({});
