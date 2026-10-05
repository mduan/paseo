import { describe, expect, it } from "vitest";
import type { ForgeSearchItem } from "@getpaseo/protocol/messages";
import {
  type BranchPickerDetail,
  branchPickerOptionId,
  buildBranchPickerItems,
  buildPickerOptionData,
  currentBranchPickerItem,
  defaultBasePickerItem,
  pickerItemToCheckoutRequest,
  type PickerItem,
} from "./new-workspace-picker-item";

const prItem: ForgeSearchItem = {
  kind: "change_request",
  number: 42,
  title: "Add picker",
  url: "https://example.com/pull/42",
  state: "open",
  body: null,
  labels: [],
  baseRefName: "main",
  headRefName: "feature/picker",
};

describe("branchPickerOptionId", () => {
  it("distinguishes a local origin-prefixed branch from the origin ref", () => {
    expect(branchPickerOptionId("refs/heads/origin/main")).not.toBe(
      branchPickerOptionId("refs/remotes/origin/main"),
    );
  });
});

describe("pickerItemToCheckoutRequest", () => {
  it("returns undefined for no selection (null)", () => {
    expect(pickerItemToCheckoutRequest(null)).toBeUndefined();
  });

  it("maps a branch row to branch-off with its exact ref", () => {
    const item: PickerItem = {
      kind: "branch",
      name: "dev",
      refName: "refs/heads/dev",
      accessibilityLabel: "dev, local branch",
    };
    expect(pickerItemToCheckoutRequest(item)).toEqual({
      action: "branch-off",
      refName: "refs/heads/dev",
    });
  });

  it("maps a github-pr row to checkout using the head ref and pr number", () => {
    const item: PickerItem = {
      kind: "github-pr",
      item: prItem,
    };
    expect(pickerItemToCheckoutRequest(item)).toEqual({
      action: "checkout",
      refName: "feature/picker",
      checkoutSource: { kind: "change_request", forge: "github", number: 42 },
      githubPrNumber: 42,
    });
  });

  it("handles a github-pr with a null baseRef", () => {
    const item: PickerItem = {
      kind: "github-pr",
      item: {
        ...prItem,
        number: 7,
        title: "Orphan branch",
        baseRefName: null,
        headRefName: "orphan",
      },
    };
    expect(pickerItemToCheckoutRequest(item)).toEqual({
      action: "checkout",
      refName: "orphan",
      checkoutSource: { kind: "change_request", forge: "github", number: 7 },
      githubPrNumber: 7,
    });
  });

  it("does not send the legacy githubPrNumber for non-GitHub change requests", () => {
    const item: PickerItem = {
      kind: "github-pr",
      item: {
        ...prItem,
        forge: "gitlab",
        number: 21,
        projectPath: "acme/repo",
        url: "https://gitlab.example.com/acme/repo/-/merge_requests/21",
      },
    };
    expect(pickerItemToCheckoutRequest(item)).toEqual({
      action: "checkout",
      refName: "feature/picker",
      checkoutSource: {
        kind: "change_request",
        forge: "gitlab",
        number: 21,
        projectPath: "acme/repo",
      },
    });
  });
});

describe("buildBranchPickerItems", () => {
  it("lists local then origin, marking the local row in sync when they match", () => {
    expect(
      buildBranchPickerItems([
        {
          name: "main",
          committerDate: 10,
          hasLocal: true,
          hasRemote: true,
          localAhead: 0,
          localBehind: 0,
        },
      ]),
    ).toEqual([
      {
        kind: "branch",
        name: "main",
        refName: "refs/heads/main",
        inSync: true,
        accessibilityLabel: "main, local branch, up to date with origin main",
        committerDate: 10,
      },
      {
        kind: "branch",
        name: "origin/main",
        refName: "refs/remotes/origin/main",
        accessibilityLabel: "origin/main, origin branch",
        committerDate: 10,
      },
    ]);
  });

  it("labels the local row with its divergence when the refs differ", () => {
    expect(
      buildBranchPickerItems([
        {
          name: "main",
          committerDate: 10,
          hasLocal: true,
          hasRemote: true,
          localAhead: 3,
          localBehind: 2,
        },
      ]),
    ).toEqual([
      {
        kind: "branch",
        name: "main",
        refName: "refs/heads/main",
        divergenceLabel: "+3 −2",
        inSync: false,
        accessibilityLabel: "main, local branch, 3 commits ahead and 2 behind origin main",
        committerDate: 10,
      },
      {
        kind: "branch",
        name: "origin/main",
        refName: "refs/remotes/origin/main",
        accessibilityLabel: "origin/main, origin branch",
        committerDate: 10,
      },
    ]);
  });

  it("uses an exact origin ref for remote-only branches", () => {
    expect(
      buildBranchPickerItems([
        {
          name: "release",
          committerDate: 5,
          hasLocal: false,
          hasRemote: true,
        },
      ]),
    ).toEqual([
      {
        kind: "branch",
        name: "origin/release",
        refName: "refs/remotes/origin/release",
        accessibilityLabel: "origin/release, origin branch",
        committerDate: 5,
      },
    ]);
  });

  it("keeps the plain name and no status for a local-only branch", () => {
    expect(
      buildBranchPickerItems([
        {
          name: "scratch",
          committerDate: 5,
          hasLocal: true,
          hasRemote: false,
        },
      ]),
    ).toEqual([
      {
        kind: "branch",
        name: "scratch",
        refName: "refs/heads/scratch",
        accessibilityLabel: "scratch, local branch",
        committerDate: 5,
      },
    ]);
  });

  it("shows both refs without status when their divergence is unavailable", () => {
    expect(
      buildBranchPickerItems([
        {
          name: "main",
          committerDate: 10,
          hasLocal: true,
          hasRemote: true,
        },
      ]),
    ).toEqual([
      {
        kind: "branch",
        name: "main",
        refName: "refs/heads/main",
        accessibilityLabel: "main, local branch",
        committerDate: 10,
      },
      {
        kind: "branch",
        name: "origin/main",
        refName: "refs/remotes/origin/main",
        accessibilityLabel: "origin/main, origin branch",
        committerDate: 10,
      },
    ]);
  });

  it("keeps the legacy unqualified row when provenance is unavailable", () => {
    expect(buildBranchPickerItems([{ name: "legacy", committerDate: 1 }])).toEqual([
      {
        kind: "branch",
        name: "legacy",
        refName: "legacy",
        accessibilityLabel: "legacy, branch",
        committerDate: 1,
      },
    ]);
  });
});

const mainRow: BranchPickerDetail = {
  name: "main",
  committerDate: 10,
  hasLocal: true,
  hasRemote: true,
  localAhead: 2,
  localBehind: 0,
};

describe("buildPickerOptionData", () => {
  it("pins the base, then local, origin, and PRs, each newest first", () => {
    const baseItem: PickerItem = {
      kind: "branch",
      name: "origin/main",
      refName: "refs/remotes/origin/main",
      accessibilityLabel: "origin/main, origin branch",
    };
    const data = buildPickerOptionData({
      branchDetails: [
        {
          name: "old",
          committerDate: 1,
          hasLocal: true,
          hasRemote: true,
          localAhead: 0,
          localBehind: 0,
        },
        mainRow,
        { name: "new", committerDate: 20, hasLocal: true, hasRemote: false },
      ],
      prItems: [{ ...prItem, updatedAt: "2099-01-01T00:00:00Z" }],
      baseItem,
    });

    expect(data.options.map((option) => option.label)).toEqual([
      "origin/main",
      "new",
      "main",
      "old",
      "origin/old",
      "#42 Add picker",
    ]);
    expect(data.selectedOptionId).toBe(branchPickerOptionId("refs/remotes/origin/main"));
  });

  it("adds a fork upstream absent from branch suggestions", () => {
    const baseItem: PickerItem = {
      kind: "branch",
      name: "upstream/main",
      refName: "refs/remotes/upstream/main",
      accessibilityLabel: "upstream/main, upstream branch",
    };
    const data = buildPickerOptionData({
      branchDetails: [{ ...mainRow, localAhead: 0, localBehind: 0 }],
      prItems: [],
      baseItem,
    });

    expect(data.options.map((option) => option.label)).toEqual([
      "upstream/main",
      "main",
      "origin/main",
    ]);
    expect(data.selectedOptionId).toBe(branchPickerOptionId("refs/remotes/upstream/main"));
  });

  it("selects the bare legacy row for the local default", () => {
    const baseItem = defaultBasePickerItem({ currentBranch: "main" });
    const data = buildPickerOptionData({
      branchDetails: [
        { name: "dev", committerDate: 20 },
        { name: "main", committerDate: 10 },
      ],
      prItems: [],
      baseItem,
    });

    expect(data.options.map((option) => option.label)).toEqual(["main", "dev"]);
    expect(data.selectedOptionId).toBe(branchPickerOptionId("main"));
  });

  it("keeps an explicit local selection marked", () => {
    const baseItem: PickerItem = {
      kind: "branch",
      name: "main",
      refName: "refs/heads/main",
      accessibilityLabel: "main, local branch",
    };
    const data = buildPickerOptionData({
      branchDetails: [mainRow],
      prItems: [],
      baseItem,
    });
    const selected = data.itemById.get(data.selectedOptionId) ?? null;
    expect(pickerItemToCheckoutRequest(selected)).toEqual({
      action: "branch-off",
      refName: "refs/heads/main",
    });
  });
});

describe("defaultBasePickerItem", () => {
  it("uses the local current branch", () => {
    expect(defaultBasePickerItem({ currentBranch: "main" })).toMatchObject({
      refName: "refs/heads/main",
      name: "main",
    });
  });

  it("falls back to the checkout's base on a detached HEAD", () => {
    expect(defaultBasePickerItem({ currentBranch: null, baseRef: "main" })).toMatchObject({
      name: "main",
      refName: "main",
    });
  });

  it("has no default for a detached HEAD without a base", () => {
    expect(defaultBasePickerItem({ currentBranch: null })).toBeNull();
    expect(defaultBasePickerItem({ currentBranch: null, baseRef: null })).toBeNull();
  });
});

describe("currentBranchPickerItem", () => {
  it("defaults to the checked-out local branch", () => {
    expect(currentBranchPickerItem({ currentBranch: "feature" })).toMatchObject({
      kind: "branch",
      name: "feature",
      refName: "refs/heads/feature",
    });
  });

  it("ignores the base on a detached head", () => {
    expect(currentBranchPickerItem({ currentBranch: null, baseRef: "main" })).toBeNull();
  });

  it("returns null on a detached head", () => {
    expect(currentBranchPickerItem({ currentBranch: null })).toBeNull();
  });
});

describe("buildPickerOptionData current branch", () => {
  const branchDetails: BranchPickerDetail[] = [
    { name: "feature", committerDate: 30, hasLocal: true, hasRemote: false },
    { name: "newer", committerDate: 40, hasLocal: true, hasRemote: false },
    {
      name: "main",
      committerDate: 10,
      hasLocal: true,
      hasRemote: true,
      localAhead: 1,
      localBehind: 0,
    },
  ];

  it("shows the current branch once when it is the base", () => {
    const data = buildPickerOptionData({
      branchDetails,
      prItems: [],
      baseItem: defaultBasePickerItem({ currentBranch: "feature" }),
      currentBranch: "feature",
    });

    expect(data.options.map((option) => option.label)).toEqual([
      "feature",
      "newer",
      "main",
      "origin/main",
    ]);
    expect(data.itemById.get(data.selectedOptionId)).toMatchObject({ current: true });
  });

  it("puts the current branch second when another base is picked", () => {
    const picked = buildBranchPickerItems(branchDetails).find(
      (item) => item.kind === "branch" && item.refName === "refs/heads/main",
    );
    const data = buildPickerOptionData({
      branchDetails,
      prItems: [],
      baseItem: picked ?? null,
      currentBranch: "feature",
    });

    expect(data.options.map((option) => option.label)).toEqual([
      "main",
      "feature",
      "newer",
      "origin/main",
    ]);
    const current = data.itemById.get(branchPickerOptionId("refs/heads/feature"));
    expect(current).toMatchObject({ current: true });
    expect(data.itemById.get(data.selectedOptionId)).not.toMatchObject({ current: true });
  });

  it("adds the current branch when suggestions omit it", () => {
    const data = buildPickerOptionData({
      branchDetails,
      prItems: [],
      baseItem: defaultBasePickerItem({ currentBranch: "feature" }),
      currentBranch: "unlisted",
    });

    expect(data.options.map((option) => option.label).slice(0, 2)).toEqual(["feature", "unlisted"]);
  });

  it("marks no current row on a detached HEAD", () => {
    const data = buildPickerOptionData({
      branchDetails,
      prItems: [],
      baseItem: defaultBasePickerItem({ currentBranch: null, baseRef: "main" }),
      currentBranch: null,
    });

    expect([...data.itemById.values()].some((item) => item.kind === "branch" && item.current)).toBe(
      false,
    );
  });
});

describe("buildPickerOptionData detached base", () => {
  it("marks the local row for a bare base, as the daemon resolves it", () => {
    const data = buildPickerOptionData({
      branchDetails: [
        {
          name: "main",
          committerDate: 10,
          hasLocal: true,
          hasRemote: true,
          localAhead: 0,
          localBehind: 0,
        },
      ],
      prItems: [],
      baseItem: defaultBasePickerItem({ currentBranch: null, baseRef: "main" }),
    });

    expect(data.selectedOptionId).toBe(branchPickerOptionId("refs/heads/main"));
    expect(data.options.map((option) => option.label)).toEqual(["main", "origin/main"]);
  });

  it("falls back to the origin row when there is no local branch", () => {
    const data = buildPickerOptionData({
      branchDetails: [{ name: "main", committerDate: 10, hasLocal: false, hasRemote: true }],
      prItems: [],
      baseItem: defaultBasePickerItem({ currentBranch: null, baseRef: "main" }),
    });

    expect(data.selectedOptionId).toBe(branchPickerOptionId("refs/remotes/origin/main"));
    expect(data.options.map((option) => option.label)).toEqual(["origin/main"]);
  });
});
