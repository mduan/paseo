import type {
  ProviderCatalog,
  ProviderLaunch,
  ProviderModel,
  ProviderMode,
  ProviderStatus,
  ProviderSessionConfig,
  ProviderThinkingOption,
} from "@getpaseo/plugin/server/provider";
import { probe } from "./process.js";
import { AntigravityError } from "./errors.js";

const modes: readonly ProviderMode[] = [
  {
    id: "accept-edits",
    icon: "ShieldCheck",
    label: "Accept File Edits",
    description: "Approve file edits automatically; ask when other actions require approval.",
  },
  {
    id: "auto",
    icon: "ShieldCheck",
    label: "Auto",
    description: "Approve edits and safe commands automatically; ask before irreversible actions.",
  },
  {
    id: "full-access",
    icon: "ShieldOff",
    colorTier: "dangerous",
    label: "Full access",
    description: "Run tools without approval using --dangerously-skip-permissions.",
    isUnattended: true,
  },
];

enum Effort {
  Low = "low",
  Medium = "medium",
  High = "high",
  Extra = "xhigh",
  Max = "max",
}

const effortLabels: Record<Effort, string> = {
  [Effort.Low]: "Low",
  [Effort.Medium]: "Medium",
  [Effort.High]: "High",
  [Effort.Extra]: "Extra",
  [Effort.Max]: "Max",
};

function modelVariant(model: ProviderModel) {
  for (const effort of Object.values(Effort)) {
    const suffix = `-${effort}`;
    const labelSuffix = ` (${effort === Effort.Extra ? "XHigh" : effortLabels[effort]})`;
    if (model.id.endsWith(suffix) && model.label.endsWith(labelSuffix)) {
      return {
        id: model.id.slice(0, -suffix.length),
        label: model.label.slice(0, -labelSuffix.length),
        effort,
      };
    }
  }
  return undefined;
}

function groupModels(variants: ProviderModel[]): ProviderModel[] {
  const families = new Map<string, ProviderModel[]>();
  for (const model of variants) {
    const variant = modelVariant(model);
    if (!variant) continue;
    const family = families.get(variant.id) ?? [];
    family.push(model);
    families.set(variant.id, family);
  }
  const models = new Map<string, ProviderModel>();
  for (const model of variants) {
    const variant = modelVariant(model);
    const family = variant && families.get(variant.id);
    if (!variant || !family || family.length < 2) {
      models.set(model.id, { ...model, thinkingOptions: [] });
      continue;
    }
    if (models.has(variant.id)) continue;
    const thinkingOptions: ProviderThinkingOption[] = [];
    for (const effort of Object.values(Effort)) {
      if (family.some((entry) => entry.id === `${variant.id}-${effort}`))
        thinkingOptions.push({ id: effort, label: effortLabels[effort] });
    }
    models.set(variant.id, {
      id: variant.id,
      label: variant.label,
      aliases: family.map((entry) => entry.id),
      thinkingOptions,
      defaultThinkingOptionId: variant.effort,
    });
  }
  return [...models.values()];
}

export async function getCatalog(launch: ProviderLaunch, cwd?: string): Promise<ProviderCatalog> {
  const output = await probe({ launch, args: ["models"], cwd });
  const models: ProviderModel[] = [];
  for (const line of output.trim().split(/\r?\n/)) {
    const [id, label, ...extra] = line.split("\t");
    if (!id || !label || extra.length > 0)
      throw new AntigravityError("Invalid `agy models` output", "INVALID_CATALOG");
    if (models.some((model) => model.id === id))
      throw new AntigravityError(`Duplicate Antigravity model: ${id}`, "INVALID_CATALOG");
    models.push({ id, label });
  }
  return {
    models: groupModels(models),
    modes,
    defaultMode: "full-access",
  };
}

export async function getStatus(launch: ProviderLaunch): Promise<ProviderStatus> {
  try {
    const version = (await probe({ launch, args: ["--version"] })).trim();
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match)
      return {
        available: false,
        diagnostic: "Could not read the Antigravity version. Update `agy` to 1.5.0 or later.",
      };
    const [, major, minor] = match.map(Number);
    const supported = major > 1 || (major === 1 && minor >= 5);
    if (!supported)
      return {
        available: false,
        diagnostic: `Antigravity ${version} is unsupported. Update \`agy\` to 1.5.0 or later.`,
      };
    await getCatalog(launch);
    return { available: true };
  } catch (error) {
    if (!(error instanceof AntigravityError)) throw error;
    return { available: false, diagnostic: error.message };
  }
}

type Selection = Pick<ProviderSessionConfig, "model" | "mode" | "thinkingOption">;

export function resolveSelection(config: Selection, catalog: ProviderCatalog): Selection {
  const model = catalog.models.find(
    (entry) => entry.id === config.model || entry.aliases?.includes(config.model ?? ""),
  );
  if (config.model && !model)
    throw new AntigravityError(`Unknown Antigravity model: ${config.model}`, "INVALID_MODEL");
  if (config.mode && !catalog.modes.some((mode) => mode.id === config.mode))
    throw new AntigravityError(`Unknown Antigravity mode: ${config.mode}`, "INVALID_MODE");
  let thinkingOption = config.thinkingOption;
  // COMPAT(antigravity-model-effort): added in v0.11.0-fork.45, remove after 2027-02-15.
  if (!thinkingOption && model && config.model !== model.id)
    thinkingOption = config.model?.slice(model.id.length + 1);
  if (thinkingOption && !model?.thinkingOptions?.some((option) => option.id === thinkingOption))
    throw new AntigravityError(`Unknown Antigravity effort: ${thinkingOption}`, "INVALID_THINKING");
  return { model: model?.id, mode: config.mode, thinkingOption };
}
