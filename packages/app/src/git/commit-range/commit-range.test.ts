import { describe, expect, it } from "vitest";
import { toggleCommitInRange } from "./commit-range";

// Newest first, as the picker lists them.
const shas = ["e", "d", "c", "b", "a"];

function click(range: { fromSha: string; toSha: string } | undefined, sha: string) {
  return toggleCommitInRange({ shas, range, sha });
}

describe("toggleCommitInRange", () => {
  it("keeps every click a contiguous range", () => {
    expect(click(undefined, "c")).toEqual({ fromSha: "c", toSha: "c" });
    expect(click({ fromSha: "c", toSha: "c" }, "a")).toEqual({ fromSha: "a", toSha: "c" });
    expect(click({ fromSha: "c", toSha: "c" }, "e")).toEqual({ fromSha: "c", toSha: "e" });
    expect(click({ fromSha: "a", toSha: "d" }, "d")).toEqual({ fromSha: "a", toSha: "c" });
    expect(click({ fromSha: "a", toSha: "d" }, "a")).toEqual({ fromSha: "b", toSha: "d" });
    expect(click({ fromSha: "a", toSha: "d" }, "c")).toEqual({ fromSha: "c", toSha: "c" });
    expect(click({ fromSha: "c", toSha: "c" }, "c")).toBeUndefined();
  });

  it("starts over when the range no longer matches the commit list", () => {
    expect(click({ fromSha: "gone", toSha: "d" }, "b")).toEqual({ fromSha: "b", toSha: "b" });
  });
});
