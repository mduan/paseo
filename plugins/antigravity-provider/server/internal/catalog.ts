import type {
  ProviderCatalog,
  ProviderLaunch,
  ProviderModel,
  ProviderMode,
  ProviderStatus,
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
    models,
    modes,
    thinkingOptions: [],
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

export function validateSelection(
  config: { model?: string; mode?: string; thinkingOption?: string },
  catalog: ProviderCatalog,
): void {
  if (config.model && !catalog.models.some((model) => model.id === config.model))
    throw new AntigravityError(`Unknown Antigravity model: ${config.model}`, "INVALID_MODEL");
  if (config.mode && !catalog.modes.some((mode) => mode.id === config.mode))
    throw new AntigravityError(`Unknown Antigravity mode: ${config.mode}`, "INVALID_MODE");
  if (config.thinkingOption)
    throw new AntigravityError(
      "Antigravity effort is selected through the model ID",
      "UNSUPPORTED_THINKING",
    );
}
