import { describe, expect, it } from "vitest";

import {
  buildAgentBranchNameSeed,
  buildAgentPrompt,
  renderPromptAttachmentAsText,
} from "./prompt-attachments.js";

describe("prompt attachments", () => {
  it("places fork history before the new user prompt", () => {
    const chatHistory = {
      type: "text" as const,
      mimeType: "text/plain",
      contextKind: "chat_history" as const,
      title: "Chat history",
      text: "<chat-history-summary>\nPrevious work\n</chat-history-summary>",
    };
    const issue = {
      type: "github_issue" as const,
      mimeType: "application/github-issue",
      number: 55,
      title: "Issue",
      url: "https://github.com/getpaseo/paseo/issues/55",
    };

    expect(
      buildAgentPrompt(
        "  Take a different approach  ",
        [{ data: "image-data", mimeType: "image/png" }],
        [issue, chatHistory],
      ),
    ).toEqual([
      chatHistory,
      { type: "text", text: "Take a different approach" },
      { type: "image", data: "image-data", mimeType: "image/png" },
      issue,
    ]);
  });

  it("renders github_pr attachments as readable text", () => {
    expect(
      renderPromptAttachmentAsText({
        type: "github_pr",
        mimeType: "application/github-pr",
        number: 123,
        title: "Fix race in worktree setup",
        url: "https://github.com/getpaseo/paseo/pull/123",
        body: "PR body",
        baseRefName: "main",
        headRefName: "fix/worktree-race",
      }),
    ).toContain("GitHub PR #123: Fix race in worktree setup");
  });

  it("renders GitLab change request attachments with MR numbering", () => {
    expect(
      renderPromptAttachmentAsText({
        type: "forge_change_request",
        mimeType: "application/paseo-forge-change-request",
        forge: "gitlab",
        number: 123,
        title: "Fix race in worktree setup",
        url: "https://gitlab.com/getpaseo/paseo/-/merge_requests/123",
        body: "MR body",
        projectPath: "getpaseo/paseo",
        baseRefName: "main",
        headRefName: "fix/worktree-race",
      }),
    ).toContain("GitLab MR !123: Fix race in worktree setup");
  });

  it("renders review attachments with compact file, line, comment, and context details", () => {
    expect(
      renderPromptAttachmentAsText({
        type: "review",
        mimeType: "application/paseo-review",
        cwd: "/tmp/repo",
        mode: "base",
        baseRef: "main",
        comments: [
          {
            filePath: "src/index.ts",
            side: "new",
            lineNumber: 42,
            body: "Please guard this nullable value.",
            context: {
              hunkHeader: "@@ -40,3 +40,4 @@",
              targetLine: {
                oldLineNumber: null,
                newLineNumber: 42,
                type: "add",
                content: "const value = maybeNull.name;",
              },
              lines: [
                {
                  oldLineNumber: 41,
                  newLineNumber: 41,
                  type: "context",
                  content: "const before = true;",
                },
                {
                  oldLineNumber: null,
                  newLineNumber: 42,
                  type: "add",
                  content: "const value = maybeNull.name;",
                },
              ],
            },
          },
        ],
      }),
    ).toBe(
      [
        "Paseo review attachment (base)",
        "CWD: /tmp/repo",
        "Base: main",
        "",
        "Comment 1: src/index.ts:R42",
        "Please guard this nullable value.",
        "@@ -40,3 +40,4 @@",
        "  41 41  const before = true;",
        ">  - 42 +const value = maybeNull.name;",
      ].join("\n"),
    );
  });

  it("renders a mixed-side range with every range line marked", () => {
    expect(
      renderPromptAttachmentAsText({
        type: "review",
        mimeType: "application/paseo-review",
        cwd: "/tmp/repo",
        mode: "uncommitted",
        comments: [
          {
            filePath: "src/index.ts",
            side: "new",
            lineNumber: 11,
            startSide: "old",
            startLineNumber: 10,
            body: "Rename both.",
            context: {
              hunkHeader: "@@ -9,3 +9,3 @@",
              targetLine: { oldLineNumber: null, newLineNumber: 11, type: "add", content: "b2" },
              lines: [
                { oldLineNumber: 9, newLineNumber: 9, type: "context", content: "a" },
                { oldLineNumber: 10, newLineNumber: null, type: "remove", content: "b" },
                { oldLineNumber: null, newLineNumber: 10, type: "add", content: "b1" },
                { oldLineNumber: null, newLineNumber: 11, type: "add", content: "b2" },
                { oldLineNumber: 11, newLineNumber: 12, type: "context", content: "c" },
              ],
            },
          },
        ],
      }),
    ).toBe(
      [
        "Paseo review attachment (uncommitted)",
        "CWD: /tmp/repo",
        "",
        "Comment 1: src/index.ts:L10-R11",
        "Rename both.",
        "@@ -9,3 +9,3 @@",
        "   9  9  a",
        "> 10  - -b",
        ">  - 10 +b1",
        ">  - 11 +b2",
        "  11 12  c",
      ].join("\n"),
    );
  });

  it("renders a cross-hunk range without a gap marker", () => {
    expect(
      renderPromptAttachmentAsText({
        type: "review",
        mimeType: "application/paseo-review",
        cwd: "/tmp/repo",
        mode: "uncommitted",
        comments: [
          {
            filePath: "src/index.ts",
            side: "new",
            lineNumber: 50,
            startSide: "new",
            startLineNumber: 3,
            body: "Same bug in both places.",
            context: {
              hunkHeader: "@@ -1,3 +1,3 @@",
              targetLine: { oldLineNumber: 50, newLineNumber: 50, type: "context", content: "z" },
              lines: [
                { oldLineNumber: 2, newLineNumber: 2, type: "context", content: "x" },
                { oldLineNumber: 3, newLineNumber: 3, type: "context", content: "y" },
                { oldLineNumber: 50, newLineNumber: 50, type: "context", content: "z" },
                { oldLineNumber: 51, newLineNumber: 51, type: "context", content: "w" },
              ],
            },
          },
        ],
      }),
    ).toBe(
      [
        "Paseo review attachment (uncommitted)",
        "CWD: /tmp/repo",
        "",
        "Comment 1: src/index.ts:R3-R50",
        "Same bug in both places.",
        "@@ -1,3 +1,3 @@",
        "   2  2  x",
        ">  3  3  y",
        "> 50 50  z",
        "  51 51  w",
      ].join("\n"),
    );
  });

  it("notes a range whose end was cut from the context", () => {
    expect(
      renderPromptAttachmentAsText({
        type: "review",
        mimeType: "application/paseo-review",
        cwd: "/tmp/repo",
        mode: "uncommitted",
        comments: [
          {
            filePath: "src/index.ts",
            side: "old",
            lineNumber: 200,
            startSide: "old",
            startLineNumber: 2,
            body: "Delete this block.",
            context: {
              hunkHeader: "@@ -1,200 +0,0 @@",
              targetLine: {
                oldLineNumber: 200,
                newLineNumber: null,
                type: "remove",
                content: "end",
              },
              lines: [
                { oldLineNumber: 1, newLineNumber: null, type: "remove", content: "one" },
                { oldLineNumber: 2, newLineNumber: null, type: "remove", content: "two" },
                { oldLineNumber: 3, newLineNumber: null, type: "remove", content: "three" },
              ],
            },
          },
        ],
      }),
    ).toBe(
      [
        "Paseo review attachment (uncommitted)",
        "CWD: /tmp/repo",
        "",
        "Comment 1: src/index.ts:L2-L200",
        "Delete this block.",
        "@@ -1,200 +0,0 @@",
        "   1  - -one",
        ">  2  - -two",
        ">  3  - -three",
        "  (Range truncated. Read src/index.ts for the rest.)",
      ].join("\n"),
    );
  });

  it("omits the hunk header line for a comment without one", () => {
    expect(
      renderPromptAttachmentAsText({
        type: "review",
        mimeType: "application/paseo-review",
        cwd: "/tmp/repo",
        mode: "base",
        comments: [
          {
            filePath: "src/index.ts",
            side: "new",
            lineNumber: 2,
            body: "Rename this.",
            context: {
              hunkHeader: "",
              targetLine: { oldLineNumber: null, newLineNumber: 2, type: "context", content: "b" },
              lines: [
                { oldLineNumber: null, newLineNumber: 1, type: "context", content: "a" },
                { oldLineNumber: null, newLineNumber: 2, type: "context", content: "b" },
              ],
            },
          },
        ],
      }),
    ).toBe(
      [
        "Paseo review attachment (base)",
        "CWD: /tmp/repo",
        "",
        "Comment 1: src/index.ts:R2",
        "Rename this.",
        "   -  1  a",
        ">  -  2  b",
      ].join("\n"),
    );
  });

  it("renders github_issue attachments as readable text", () => {
    expect(
      renderPromptAttachmentAsText({
        type: "github_issue",
        mimeType: "application/github-issue",
        number: 55,
        title: "Issue",
        url: "https://github.com/getpaseo/paseo/issues/55",
      }),
    ).toContain("GitHub Issue #55: Issue");
  });

  it("renders text attachments as their client-provided prompt text", () => {
    expect(
      renderPromptAttachmentAsText({
        type: "text",
        mimeType: "text/plain",
        title: "Browser element",
        text: "<browser-element>button.primary</browser-element>",
      }),
    ).toBe("<browser-element>button.primary</browser-element>");
  });

  it("renders uploaded file attachments as local file references", () => {
    expect(
      renderPromptAttachmentAsText({
        type: "uploaded_file",
        id: "upload_req-upload",
        fileName: "notes.txt",
        mimeType: "text/plain",
        size: 11,
        path: "/tmp/paseo/uploads/upload_req-upload/notes.txt",
      }),
    ).toBe(
      [
        "Uploaded file: notes.txt",
        "Path: /tmp/paseo/uploads/upload_req-upload/notes.txt",
        "MIME: text/plain",
        "Size: 11 bytes",
      ].join("\n"),
    );
  });

  it("returns undefined when firstAgentContext is empty", () => {
    expect(buildAgentBranchNameSeed(undefined)).toBeUndefined();
    expect(buildAgentBranchNameSeed({})).toBeUndefined();
    expect(buildAgentBranchNameSeed({ prompt: "   " })).toBeUndefined();
    expect(buildAgentBranchNameSeed({ attachments: [] })).toBeUndefined();
  });

  it("wraps prompt and rendered attachments as tagged naming input", () => {
    expect(
      buildAgentBranchNameSeed({
        prompt: "Investigate flaky test",
        attachments: [
          {
            type: "github_pr",
            mimeType: "application/github-pr",
            number: 123,
            title: "Fix worktree naming",
            url: "https://github.com/getpaseo/paseo/pull/123",
            baseRefName: "main",
            headRefName: "fix/worktree-naming",
          },
        ],
      }),
    ).toBe(
      "<user-prompt>\nInvestigate flaky test\n</user-prompt>\n\n<attachments>\nGitHub PR #123: Fix worktree naming\nhttps://github.com/getpaseo/paseo/pull/123\nBase: main\nHead: fix/worktree-naming\n</attachments>",
    );
  });
});
