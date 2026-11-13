import { describe, expect, it } from "vitest";
import { getBuiltInLaunchOrder, WorkspaceTabLaunchPurpose } from "./catalog";

describe("getBuiltInLaunchOrder", () => {
  it("leads with creating work in a primary pane", () => {
    expect(getBuiltInLaunchOrder(WorkspaceTabLaunchPurpose.Primary)).toEqual([
      "agent",
      "terminal",
      "browser",
      "diff",
      "pullRequest",
    ]);
  });

  it("leads with companion tools in a supporting pane", () => {
    expect(getBuiltInLaunchOrder(WorkspaceTabLaunchPurpose.Supporting)).toEqual([
      "terminal",
      "agent",
      "diff",
      "browser",
      "pullRequest",
    ]);
  });

  it("keeps Explorer views available for tab configuration", () => {
    expect(getBuiltInLaunchOrder(WorkspaceTabLaunchPurpose.Configuration)).toEqual([
      "changes",
      "files",
    ]);
  });
});
