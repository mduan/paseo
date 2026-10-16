import type { FirstAgentContext } from "@getpaseo/protocol/messages";

function deriveInitialAgentTitle(prompt: string): string | null {
  const firstContentLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstContentLine) {
    return null;
  }
  const normalized = firstContentLine.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized;
}

export function resolveCreateAgentTitles(options: {
  configTitle?: string | null;
  initialPrompt?: string | null;
}): { explicitTitle: string | null; provisionalTitle: string | null } {
  const explicitTitle =
    typeof options.configTitle === "string" && options.configTitle.trim().length > 0
      ? options.configTitle.trim()
      : null;
  const trimmedPrompt = options.initialPrompt?.trim();
  const provisionalTitle =
    explicitTitle ?? (trimmedPrompt ? deriveInitialAgentTitle(trimmedPrompt) : null);

  return {
    explicitTitle,
    provisionalTitle,
  };
}

export function resolveFirstAgentPromptTitle(firstAgentContext?: FirstAgentContext): string | null {
  return (
    resolveCreateAgentTitles({
      initialPrompt: firstAgentContext?.prompt,
    }).provisionalTitle ?? null
  );
}

// Forks prefix "(N) " so the generation survives truncation of long titles.
// Only single digits count, so "(9) X" forks to "(1) (9) X".
export function buildForkAgentTitle(sourceTitle: string): string {
  const match = /^\(([1-8])\) /.exec(sourceTitle);
  if (!match) {
    return `(1) ${sourceTitle}`;
  }
  return `(${Number(match[1]) + 1}) ${sourceTitle.slice(match[0].length)}`;
}
