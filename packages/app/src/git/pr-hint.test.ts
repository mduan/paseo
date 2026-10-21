import { createTextSearch } from "@getpaseo/protocol/search/query";
import { pullRequestNumberRanges } from "@getpaseo/protocol/pull-request";
import { describe, expect, it } from "vitest";

import { selectPrHintFromStatus } from "./pr-hint";

const githubStatus = {
  url: "https://github.com/acme/repo/pull/42",
  state: "open",
  isMerged: false,
};

const gitlabStatus = {
  url: "https://gitlab.com/group/proj/-/merge_requests/7",
  state: "open",
  isMerged: false,
};

describe("selectPrHintFromStatus", () => {
  it("carries linked issues and leaves them absent for older daemons", () => {
    const linearIssues = [
      { identifier: "COR-1", url: "https://linear.app/acme/issue/COR-1", title: "Fix" },
    ];
    expect(selectPrHintFromStatus({ ...githubStatus, linearIssues })?.linearIssues).toBe(
      linearIssues,
    );
    expect(selectPrHintFromStatus(githubStatus)?.linearIssues).toBeUndefined();
  });
  it("keeps draft separate from open without overriding merged or closed", () => {
    expect(selectPrHintFromStatus({ ...githubStatus, isDraft: true })?.state).toBe("draft");
    expect(selectPrHintFromStatus({ ...githubStatus, isDraft: false })?.state).toBe("open");
    expect(selectPrHintFromStatus({ ...githubStatus, isDraft: true, isMerged: true })?.state).toBe(
      "merged",
    );
    expect(selectPrHintFromStatus({ ...githubStatus, isDraft: true, state: "closed" })?.state).toBe(
      "closed",
    );
  });
  it("defaults the forge to github when none is supplied (old daemon)", () => {
    const hint = selectPrHintFromStatus(githubStatus);
    expect(hint).toMatchObject({ number: 42, forge: "github" });
  });

  it("carries the resolved forge onto the hint", () => {
    const hint = selectPrHintFromStatus(githubStatus, "github");
    expect(hint?.forge).toBe("github");
  });

  it("parses a GitLab merge-request URL and carries the gitlab forge", () => {
    const hint = selectPrHintFromStatus(gitlabStatus, "gitlab");
    expect(hint).toMatchObject({ number: 7, forge: "gitlab" });
  });

  it("passes an unknown forge id through untouched", () => {
    const hint = selectPrHintFromStatus(githubStatus, "bitbucket");
    expect(hint?.forge).toBe("bitbucket");
  });

  it("returns null when the url has no parseable change-request number", () => {
    expect(
      selectPrHintFromStatus({ url: "https://example.com/x", state: "open", isMerged: false }),
    ).toBeNull();
  });
});

describe("pullRequestNumberRanges", () => {
  it("highlights numeric and prefixed queries against a number-only badge", () => {
    expect(
      pullRequestNumberRanges({ number: 482, search: createTextSearch({ query: "48" }) }),
    ).toEqual([{ start: 0, length: 2 }]);
    expect(
      pullRequestNumberRanges({ number: 482, search: createTextSearch({ query: "#48" }) }),
    ).toEqual([{ start: 0, length: 2 }]);
    expect(
      pullRequestNumberRanges({
        number: 482,
        forge: "gitlab",
        search: createTextSearch({ query: "!482", options: { wholeWord: true } }),
      }),
    ).toEqual([{ start: 0, length: 3 }]);
    expect(
      pullRequestNumberRanges({ number: 482, search: createTextSearch({ query: "#999" }) }),
    ).toEqual([]);
  });
});
