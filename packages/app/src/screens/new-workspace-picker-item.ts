import type { CreatePaseoWorktreeInput } from "@getpaseo/client/internal/daemon-client";
import type { ForgeSearchItem } from "@getpaseo/protocol/messages";
import type { ComboboxOptionModel } from "@/components/ui/combobox-options";
import { getForgePresentation } from "@/git/forge";

export interface BranchPickerDetail {
  name: string;
  committerDate: number;
  hasLocal?: boolean;
  hasRemote?: boolean;
  localAhead?: number;
  localBehind?: number;
}

export type PickerItem =
  | {
      kind: "branch";
      name: string;
      refName: string;
      accessibilityLabel: string;
      divergenceLabel?: string;
      // The local ref points at the same commit as its origin counterpart.
      inSync?: boolean;
      committerDate?: number;
    }
  | {
      kind: "github-pr";
      item: ForgeSearchItem;
    };

export type PickerCheckoutRequest = Pick<
  CreatePaseoWorktreeInput,
  "action" | "refName" | "checkoutSource" | "githubPrNumber"
>;

const BRANCH_OPTION_PREFIX = "branch:";
const PR_OPTION_PREFIX = "github-pr:";
const REMOTE_TRACKING_PREFIX = "refs/remotes/";

export function branchPickerOptionId(refName: string): string {
  return `${BRANCH_OPTION_PREFIX}${refName}`;
}

function divergenceLabel(ahead: number, behind: number): string | undefined {
  const parts = [ahead > 0 ? `+${ahead}` : null, behind > 0 ? `−${behind}` : null].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function commitCount(count: number): string {
  return `${count} ${count === 1 ? "commit" : "commits"}`;
}

function divergenceAccessibility(ahead: number, behind: number, counterpart: string): string {
  if (ahead === 0 && behind === 0) {
    return `up to date with ${counterpart}`;
  }
  if (ahead > 0 && behind > 0) {
    return `${commitCount(ahead)} ahead and ${behind} behind ${counterpart}`;
  }
  if (ahead > 0) {
    return `${commitCount(ahead)} ahead of ${counterpart}`;
  }
  return `${commitCount(behind)} behind ${counterpart}`;
}

export function buildBranchPickerItems(details: readonly BranchPickerDetail[]): PickerItem[] {
  const items: PickerItem[] = [];

  for (const detail of details) {
    const hasKnownProvenance = detail.hasLocal !== undefined || detail.hasRemote !== undefined;
    if (!hasKnownProvenance) {
      // COMPAT(branchProvenance): daemons predating hasLocal/hasRemote send bare names, so a
      // remote-only branch reads like a local one here. Remove once the daemon floor reports
      // provenance.
      items.push({
        kind: "branch",
        name: detail.name,
        refName: detail.name,
        accessibilityLabel: `${detail.name}, branch`,
        committerDate: detail.committerDate,
      });
      continue;
    }

    // Labels are short ref names, as git prints them: "main" is the local branch and
    // "origin/main" is the remote-tracking ref, so both refs always get their own row.
    if (detail.hasLocal) {
      const localItem: Extract<PickerItem, { kind: "branch" }> = {
        kind: "branch",
        name: detail.name,
        refName: `refs/heads/${detail.name}`,
        accessibilityLabel: `${detail.name}, local branch`,
        committerDate: detail.committerDate,
      };
      const localAhead = detail.localAhead;
      const localBehind = detail.localBehind;
      if (detail.hasRemote && localAhead !== undefined && localBehind !== undefined) {
        localItem.divergenceLabel = divergenceLabel(localAhead, localBehind);
        localItem.inSync = localAhead === 0 && localBehind === 0;
        localItem.accessibilityLabel += `, ${divergenceAccessibility(
          localAhead,
          localBehind,
          `origin ${detail.name}`,
        )}`;
      }
      items.push(localItem);
    }

    if (detail.hasRemote) {
      items.push({
        kind: "branch",
        name: `origin/${detail.name}`,
        refName: `refs/remotes/origin/${detail.name}`,
        accessibilityLabel: `origin/${detail.name}, origin branch`,
        committerDate: detail.committerDate,
      });
    }
  }

  return items;
}

export interface BaseRefCheckoutStatus {
  currentBranch: string | null;
  upstreamRef?: string | null;
}

// Display only. The exact ref is what every request carries; this is how git prints it, so
// "refs/remotes/origin/main" reads "origin/main" and "refs/heads/main" reads "main".
function shortRefName(refName: string): string {
  if (refName.startsWith("refs/heads/")) return refName.slice("refs/heads/".length);
  if (refName.startsWith(REMOTE_TRACKING_PREFIX)) {
    return refName.slice(REMOTE_TRACKING_PREFIX.length);
  }
  return refName;
}

// The one owner of "what do we branch off when the user picked nothing". The checkmarked
// row, the trigger label, and the created ref all read this; computing it twice is how the
// picker once showed local main while branching off something else.
//
// The upstream wins when the branch has one, because branching off the local ref silently
// carries unpushed commits into the new workspace. The daemon sends the resolved ref rather
// than a remote name, so a fork tracking upstream/main branches from upstream/main.
export function defaultBasePickerItem(status: BaseRefCheckoutStatus): PickerItem | null {
  const currentBranch = status.currentBranch;
  if (!currentBranch) return null;
  // COMPAT(checkoutUpstreamRef): added in v0.2.6, remove after 2027-02-01 once the daemon
  // floor sends upstreamRef. Daemons that predate it omit the field, which lands on the
  // local ref — the base those daemons always used.
  const refName = status.upstreamRef ?? `refs/heads/${currentBranch}`;
  const name = shortRefName(refName);
  return {
    kind: "branch",
    name,
    refName,
    accessibilityLabel: status.upstreamRef ? `${name}, upstream branch` : `${name}, local branch`,
  };
}

// A local checkout switches branches in place, so picking nothing means staying on the
// branch that is already checked out.
export function currentBranchPickerItem(status: BaseRefCheckoutStatus): PickerItem | null {
  const currentBranch = status.currentBranch;
  if (!currentBranch) return null;
  return {
    kind: "branch",
    name: currentBranch,
    refName: `refs/heads/${currentBranch}`,
    accessibilityLabel: `${currentBranch}, local branch`,
  };
}

export function pickerItemToCheckoutRequest(
  item: PickerItem | null,
): PickerCheckoutRequest | undefined {
  if (!item) return undefined;
  switch (item.kind) {
    case "branch":
      return { action: "branch-off", refName: item.refName };
    case "github-pr": {
      const headRefName = item.item.headRefName?.trim();
      const forge = item.item.forge ?? "github";
      return {
        action: "checkout",
        ...(headRefName ? { refName: headRefName } : {}),
        checkoutSource: {
          kind: "change_request",
          forge,
          number: item.item.number,
          ...(item.item.projectPath ? { projectPath: item.item.projectPath } : {}),
        },
        ...(forge === "github"
          ? {
              // COMPAT(githubPrNumber): send the legacy GitHub checkout input
              // to daemons predating checkoutSource. Remove after 2027-01-17
              // once the supported daemon floor is >= v0.2.0.
              githubPrNumber: item.item.number,
            }
          : {}),
      };
    }
  }
}

export function prPickerOptionId(number: number): string {
  return `${PR_OPTION_PREFIX}${number}`;
}

export function pickerOptionId(item: PickerItem): string {
  return item.kind === "branch"
    ? branchPickerOptionId(item.refName)
    : prPickerOptionId(item.item.number);
}

function formatPrLabel(item: Pick<ForgeSearchItem, "forge" | "number" | "title">): string {
  const presentation = getForgePresentation(item.forge ?? "github");
  return `${presentation.numberPrefix}${item.number} ${item.title}`;
}

export function pickerItemLabel(item: PickerItem): string {
  return item.kind === "branch" ? item.name : formatPrLabel(item.item);
}

export interface PickerOptionData {
  options: ComboboxOptionModel[];
  itemById: Map<string, PickerItem>;
  selectedOptionId: string;
}

// Rows sort by group, then newest first within a group.
enum PickerGroup {
  Base,
  Local,
  Remote,
  ChangeRequest,
}

interface TimedOption {
  option: ComboboxOptionModel;
  group: PickerGroup;
  timestamp: number;
}

export function buildPickerOptionData(input: {
  branchDetails: readonly BranchPickerDetail[];
  prItems: readonly ForgeSearchItem[];
  baseItem: PickerItem | null;
}): PickerOptionData {
  const itemById = new Map<string, PickerItem>();
  const timedOptions: TimedOption[] = [];

  for (const branch of buildBranchPickerItems(input.branchDetails)) {
    if (branch.kind !== "branch") continue;
    const id = branchPickerOptionId(branch.refName);
    itemById.set(id, branch);
    timedOptions.push({
      option: { id, label: pickerItemLabel(branch) },
      group: branch.refName.startsWith(REMOTE_TRACKING_PREFIX)
        ? PickerGroup.Remote
        : PickerGroup.Local,
      timestamp: branch.committerDate ?? 0,
    });
  }

  for (const pr of input.prItems) {
    if (!pr.headRefName) continue;
    const id = prPickerOptionId(pr.number);
    itemById.set(id, { kind: "github-pr", item: pr });
    const updatedAtMs = pr.updatedAt ? Date.parse(pr.updatedAt) : 0;
    const timestamp = Number.isNaN(updatedAtMs) ? 0 : Math.floor(updatedAtMs / 1000);
    timedOptions.push({
      option: { id, label: formatPrLabel(pr) },
      group: PickerGroup.ChangeRequest,
      timestamp,
    });
  }

  const selectedOptionId = input.baseItem ? baseOptionId(input.baseItem, itemById) : "";
  if (input.baseItem && !itemById.has(selectedOptionId)) {
    itemById.set(selectedOptionId, input.baseItem);
    timedOptions.push({
      option: { id: selectedOptionId, label: pickerItemLabel(input.baseItem) },
      group: PickerGroup.Base,
      timestamp: 0,
    });
  }
  // The base sorts first: it is what a workspace is created from unless you pick something.
  for (const timed of timedOptions) {
    if (timed.option.id === selectedOptionId) timed.group = PickerGroup.Base;
  }

  timedOptions.sort((a, b) => a.group - b.group || b.timestamp - a.timestamp);
  return { options: timedOptions.map((t) => t.option), itemById, selectedOptionId };
}

function baseOptionId(baseItem: PickerItem, itemById: ReadonlyMap<string, PickerItem>): string {
  const id = pickerOptionId(baseItem);
  // COMPAT(branchProvenance): a daemon without provenance lists local main as the bare row
  // "main", which is the same branch as the default base refs/heads/main. Remove with the
  // bare rows in buildBranchPickerItems.
  if (
    !itemById.has(id) &&
    baseItem.kind === "branch" &&
    baseItem.refName.startsWith("refs/heads/")
  ) {
    const bareId = branchPickerOptionId(shortRefName(baseItem.refName));
    if (itemById.has(bareId)) return bareId;
  }
  return id;
}
