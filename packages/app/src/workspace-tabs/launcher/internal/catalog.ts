export enum WorkspaceTabLaunchPurpose {
  Primary = "primary",
  Supporting = "supporting",
  Configuration = "configuration",
}

export const PRIMARY_LAUNCH_ORDER = [
  "agent",
  "terminal",
  "browser",
  "diff",
  "pullRequest",
] as const;

export const SUPPORTING_LAUNCH_ORDER = [
  "terminal",
  "agent",
  "diff",
  "browser",
  "pullRequest",
] as const;

export const CONFIGURATION_LAUNCH_ORDER = ["changes", "files"] as const;

export type BuiltInLaunchItemId =
  | (typeof PRIMARY_LAUNCH_ORDER)[number]
  | (typeof CONFIGURATION_LAUNCH_ORDER)[number];

export function getBuiltInLaunchOrder(purpose: WorkspaceTabLaunchPurpose) {
  if (purpose === WorkspaceTabLaunchPurpose.Configuration) return CONFIGURATION_LAUNCH_ORDER;
  return purpose === WorkspaceTabLaunchPurpose.Supporting
    ? SUPPORTING_LAUNCH_ORDER
    : PRIMARY_LAUNCH_ORDER;
}
