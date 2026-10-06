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
      // The branch checked out in the source checkout.
      current?: boolean;
      // A detached HEAD: refName is the commit, name its short form.
      detached?: boolean;
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
  // The base the daemon resolves for this checkout: a picked base, else the repository default
  // branch. A bare branch name, e.g. "main".
  baseRef?: string | null;
  // The commit a detached HEAD points at.
  headSha?: string | null;
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

function localBranchPickerItem(branch: string): PickerItem {
  return {
    kind: "branch",
    name: branch,
    refName: `refs/heads/${branch}`,
    accessibilityLabel: `${branch}, local branch`,
  };
}

// What the source checkout has checked out: its branch, or the commit of a detached HEAD.
// A local checkout switches in place, so picking nothing means staying on this.
export function currentBranchPickerItem(status: BaseRefCheckoutStatus): PickerItem | null {
  if (status.currentBranch) return localBranchPickerItem(status.currentBranch);
  const headSha = status.headSha?.trim();
  if (!headSha) return null;
  const shortSha = headSha.slice(0, 7);
  return {
    kind: "branch",
    name: shortSha,
    refName: headSha,
    detached: true,
    accessibilityLabel: `Detached HEAD at ${shortSha}`,
  };
}

// The one owner of "what do we branch off when the user picked nothing". The checkmarked
// row, the trigger label, and the created ref all read this; computing it twice is how the
// picker once showed local main while branching off something else.
//
// The default is the source checkout's local branch, so unpushed commits on it carry into the
// new workspace. Pick the remote row to branch off what's published instead. A detached HEAD
// falls back to the checkout's base; its commit stays one pick away as the current row. The
// base is sent as the bare name, which the daemon resolves local-first, then origin;
// baseOptionId marks the row the same way.
export function defaultBasePickerItem(status: BaseRefCheckoutStatus): PickerItem | null {
  if (status.currentBranch) return localBranchPickerItem(status.currentBranch);
  const baseRef = status.baseRef?.trim();
  if (!baseRef) return null;
  return {
    kind: "branch",
    name: baseRef,
    refName: baseRef,
    accessibilityLabel: `${baseRef}, default branch`,
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

// An explicit pick already names its ref, so only the default base needs the checkout status.
// Skipping that round trip is what lets a worktree create start without waiting on the source
// checkout's git state.
export async function resolveWorktreeCheckoutRequest(input: {
  selectedItem: PickerItem | null;
  loadCheckoutStatus: () => Promise<BaseRefCheckoutStatus>;
}): Promise<PickerCheckoutRequest | undefined> {
  if (input.selectedItem) return pickerItemToCheckoutRequest(input.selectedItem);
  return pickerItemToCheckoutRequest(defaultBasePickerItem(await input.loadCheckoutStatus()));
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
  Current,
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
  currentItem?: PickerItem | null;
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
  const currentOptionId = markCurrentBranch({
    currentItem: input.currentItem ?? null,
    itemById,
    timedOptions,
  });
  // The base sorts first: it is what a workspace is created from unless you pick something.
  // The checked-out branch follows it, so the way back is always one row away.
  for (const timed of timedOptions) {
    if (timed.option.id === selectedOptionId) timed.group = PickerGroup.Base;
    else if (timed.option.id === currentOptionId) timed.group = PickerGroup.Current;
  }

  timedOptions.sort((a, b) => a.group - b.group || b.timestamp - a.timestamp);
  return { options: timedOptions.map((t) => t.option), itemById, selectedOptionId };
}

// What is checked out gets its own row even when suggestions omit it, flagged so the row
// can say so. Returns its option id, or "" when nothing is known.
function markCurrentBranch(input: {
  currentItem: PickerItem | null;
  itemById: Map<string, PickerItem>;
  timedOptions: TimedOption[];
}): string {
  const { currentItem } = input;
  if (currentItem?.kind !== "branch") return "";
  const id = baseOptionId(currentItem, input.itemById);
  const listed = input.itemById.get(id);
  if (!listed) {
    input.timedOptions.push({
      option: { id, label: pickerItemLabel(currentItem) },
      group: PickerGroup.Current,
      timestamp: 0,
    });
  }
  const base = listed?.kind === "branch" ? listed : currentItem;
  // A picked row comes back as the base already marked; mark it once.
  if (base.current) return id;
  input.itemById.set(id, {
    ...base,
    current: true,
    accessibilityLabel: `${base.accessibilityLabel}, current branch`,
  });
  return id;
}

function baseOptionId(baseItem: PickerItem, itemById: ReadonlyMap<string, PickerItem>): string {
  const id = pickerOptionId(baseItem);
  if (itemById.has(id) || baseItem.kind !== "branch") return id;
  return (
    baseOptionIdCandidates(baseItem.refName)
      .map(branchPickerOptionId)
      .find((candidate) => itemById.has(candidate)) ?? id
  );
}

function baseOptionIdCandidates(refName: string): string[] {
  // COMPAT(branchProvenance): a daemon without provenance lists local main as the bare row
  // "main", which is the same branch as the default base refs/heads/main. Remove with the
  // bare rows in buildBranchPickerItems.
  if (refName.startsWith("refs/heads/")) return [shortRefName(refName)];
  if (refName.startsWith("refs/")) return [];
  // A bare name resolves the way the daemon resolves it: local first, then origin.
  return [`refs/heads/${refName}`, `${REMOTE_TRACKING_PREFIX}origin/${refName}`];
}
