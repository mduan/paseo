import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { buildReviewAttachmentSnapshot, buildReviewDraftKey } from "./store";
import { buildDiffReviewContext, buildFileReviewContext } from "./context";
import type { ReviewLineRange } from "./range";
import { buildReviewableDiffTargetKey, type ReviewableDiffTarget } from "@/utils/diff-layout";
import {
  addCommentToState,
  clearReviewInState,
  deleteCommentFromState,
  normalizePersistedState,
  type ReviewDraftComment,
  type ReviewDraftCommentContext,
  type ReviewDraftStoreState,
  serializeReviewDraftState,
  SerializedReviewDraftStateSchema,
  updateCommentInState,
} from "./state";

function emptyState(): ReviewDraftStoreState {
  return { drafts: {} };
}

function makeComment(overrides: Partial<ReviewDraftComment> = {}): ReviewDraftComment {
  return {
    id: "comment-1",
    filePath: "src/example.ts",
    side: "new",
    lineNumber: 41,
    body: "Please simplify this.",
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
    ...overrides,
  };
}

function makeFile(): ParsedDiffFile {
  return {
    path: "src/example.ts",
    isNew: false,
    isDeleted: false,
    additions: 1,
    deletions: 1,
    status: "ok",
    hunks: [
      {
        oldStart: 40,
        oldCount: 4,
        newStart: 40,
        newCount: 4,
        lines: [
          { type: "header", content: "@@ -40,4 +40,4 @@" },
          { type: "context", content: "const before = true;" },
          { type: "remove", content: "const value = oldValue;" },
          { type: "add", content: "const value = newValue;" },
          { type: "context", content: "return value;" },
        ],
      },
    ],
  };
}

function createMemoryStorage(): StateStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

describe("buildReviewDraftKey", () => {
  it("scopes by server and workspace-or-cwd only, so edits keep the same comments", () => {
    expect(
      buildReviewDraftKey({ serverId: " local ", workspaceId: " workspace-1 ", cwd: "/repo" }),
    ).toBe("review:server=local:workspace=workspace-1");
    expect(buildReviewDraftKey({ serverId: "local", workspaceId: null, cwd: "/repo/" })).toBe(
      "review:server=local:cwd=%2Frepo",
    );
  });
});

describe("normalizePersistedState", () => {
  it("keeps v1 review comments for migration while dropping the legacy mode field", async () => {
    const backing = createMemoryStorage();
    const legacyState = {
      drafts: { "review:key": [makeComment()] },
      activeModesByScope: { "review:scope": "base" },
    };
    backing.values.set(
      "@paseo:review-draft-store",
      JSON.stringify({ state: legacyState, version: 1 }),
    );
    const storage = createValidatedPersistStorage(backing, SerializedReviewDraftStateSchema);

    const stored = await storage.getItem("@paseo:review-draft-store");
    const normalized = normalizePersistedState(stored?.state);

    expect(normalized.drafts["review:key"]).toEqual([makeComment()]);
    expect(backing.values.has("@paseo:review-draft-store")).toBe(true);
  });

  it("merges drafts saved per diff mode into one set per workspace", () => {
    const normalized = normalizePersistedState({
      drafts: {
        "review:server=local:workspace=w1:mode=base:base=main:ignoreWhitespace=false": [
          makeComment({ id: "a" }),
        ],
        "review:server=local:workspace=w1:mode=uncommitted:base=main:ignoreWhitespace=true": [
          makeComment({ id: "b" }),
          makeComment({ id: "a" }),
        ],
      },
    });

    expect(normalized.drafts).toEqual({
      "review:server=local:workspace=w1": [makeComment({ id: "a" }), makeComment({ id: "b" })],
    });
  });

  it("merges drafts saved per diff mode into one set per workspace", () => {
    const normalized = normalizePersistedState({
      drafts: {
        "review:server=local:workspace=w1:mode=base:base=main:ignoreWhitespace=false": [
          makeComment({ id: "a" }),
        ],
        "review:server=local:workspace=w1:mode=uncommitted:base=main:ignoreWhitespace=true": [
          makeComment({ id: "b" }),
          makeComment({ id: "a" }),
        ],
      },
    });

    expect(normalized.drafts).toEqual({
      "review:server=local:workspace=w1": [makeComment({ id: "a" }), makeComment({ id: "b" })],
    });
  });

  it("rejects the complete payload when any draft comment or field is invalid", () => {
    const normalized = normalizePersistedState({
      drafts: {
        "review:key": [
          {
            id: "comment-1",
            filePath: "src/example.ts",
            side: "new",
            lineNumber: 41,
            body: "Keep me.",
            createdAt: "2026-04-21T00:00:00.000Z",
            updatedAt: "2026-04-21T00:00:00.000Z",
          },
          { id: "bad", filePath: "src/example.ts" },
        ],
      },
      // Old persisted field — must be tolerated and ignored, not migrated.
      activeModesByScope: {
        "review:scope:base": "base",
        "review:scope:dirty": "uncommitted",
      },
    });

    expect(normalized.drafts).toEqual({});
  });

  it("returns empty state for null, non-object, or malformed inputs", () => {
    expect(normalizePersistedState(null)).toEqual({ drafts: {} });
    expect(normalizePersistedState("nope")).toEqual({ drafts: {} });
    expect(normalizePersistedState({ drafts: [] })).toEqual({ drafts: {} });
  });
});

describe("serializeReviewDraftState", () => {
  it("serialized output does not contain the legacy activeModesByScope field", () => {
    const state = addCommentToState(emptyState(), { key: "review:key", comment: makeComment() });

    const serialized = serializeReviewDraftState(state);

    expect(Object.keys(serialized)).toEqual(["drafts"]);
    expect("activeModesByScope" in serialized).toBe(false);
    expect(serialized.drafts["review:key"]).toHaveLength(1);
  });
});

describe("review draft reducers", () => {
  it("adds, updates, and deletes draft comments by key", () => {
    let state = emptyState();
    const comment = makeComment();

    state = addCommentToState(state, { key: "review:key", comment });
    expect(state.drafts["review:key"]).toEqual([comment]);

    state = updateCommentInState(state, {
      key: "review:key",
      id: comment.id,
      updates: { body: "Please simplify this condition." },
      updatedAt: "2026-04-21T00:01:00.000Z",
    });
    expect(state.drafts["review:key"]?.[0]).toEqual({
      ...comment,
      body: "Please simplify this condition.",
      updatedAt: "2026-04-21T00:01:00.000Z",
    });

    state = deleteCommentFromState(state, { key: "review:key", id: comment.id });
    expect(state.drafts["review:key"]).toEqual([]);
  });

  it("keeps state identity on no-op updates, deletes, and clears", () => {
    const state = addCommentToState(emptyState(), {
      key: "review:key",
      comment: makeComment(),
    });

    expect(
      updateCommentInState(state, {
        key: "review:key",
        id: "missing",
        updates: { body: "x" },
        updatedAt: "2026-04-21T00:01:00.000Z",
      }),
    ).toBe(state);
    expect(deleteCommentFromState(state, { key: "review:key", id: "missing" })).toBe(state);
    expect(clearReviewInState(state, { key: "other-key" })).toBe(state);
  });
});

function diffTarget(input: {
  side: "old" | "new";
  lineNumber: number;
  content?: string;
}): ReviewableDiffTarget {
  return {
    key: buildReviewableDiffTargetKey({ filePath: "src/example.ts", ...input }),
    filePath: "src/example.ts",
    hunkHeader: "",
    hunkIndex: 0,
    lineIndex: 0,
    oldLineNumber: input.side === "old" ? input.lineNumber : null,
    newLineNumber: input.side === "new" ? input.lineNumber : null,
    side: input.side,
    lineNumber: input.lineNumber,
    lineType: "context",
    content: input.content ?? "",
  };
}

function lineRange(
  start: { side: "old" | "new"; lineNumber: number; content?: string },
  end: { side: "old" | "new"; lineNumber: number; content?: string } = start,
): ReviewLineRange {
  return { start: diffTarget(start), end: diffTarget(end) };
}

describe("buildReviewAttachmentSnapshot", () => {
  const storedContext = {
    hunkHeader: "@@ -40,4 +40,4 @@",
    targetLine: {
      oldLineNumber: null,
      newLineNumber: 41,
      type: "add" as const,
      content: "const value = newValue;",
    },
    lines: [
      {
        oldLineNumber: 40,
        newLineNumber: 40,
        type: "context" as const,
        content: "const before = true;",
      },
    ],
  };

  it.each([false, true])("builds review attachments (combined=%s)", (includeUncommitted) => {
    const snapshot = buildReviewAttachmentSnapshot({
      reviewDraftKey: "review:key",
      cwd: "/repo",
      mode: "base",
      includeUncommitted,
      baseRef: "main",
      comments: [
        makeComment({ context: storedContext }),
        makeComment({ id: "comment-2", filePath: "src/missing.ts", lineNumber: 99 }),
      ],
    });

    expect(snapshot).toEqual({
      kind: "review",
      reviewDraftKey: "review:key",
      commentCount: 1,
      attachment: {
        type: "review",
        mimeType: "application/paseo-review",
        cwd: "/repo",
        mode: "base",
        ...(includeUncommitted ? { includeUncommitted: true } : {}),
        baseRef: "main",
        comments: [
          {
            filePath: "src/example.ts",
            side: "new",
            lineNumber: 41,
            body: "Please simplify this.",
            context: storedContext,
          },
        ],
      },
    });
  });

  it("forwards a file-view comment's source and stores it through the schema", () => {
    const fileComment = makeComment({ context: storedContext, source: "file" });
    expect(
      SerializedReviewDraftStateSchema.safeParse({ drafts: { k: [fileComment] } }).success,
    ).toBe(true);
    const snapshot = buildReviewAttachmentSnapshot({
      reviewDraftKey: "review:key",
      cwd: "/repo",
      mode: "base",
      comments: [fileComment, makeComment({ id: "diff", context: storedContext })],
    });
    expect(snapshot?.attachment.comments[0]?.source).toBe("file");
    expect(snapshot?.attachment.comments[1]).not.toHaveProperty("source");
  });

  it("retains each turn's snapshot through persistence and the shared chat attachment", () => {
    const firstSnapshot = { cwd: "/repo", fromTree: "before", toTree: "after" };
    const secondSnapshot = { ...firstSnapshot, fromTree: "after", toTree: "later" };
    const comments = [
      makeComment({ context: storedContext, snapshot: firstSnapshot }),
      makeComment({ id: "second", context: storedContext, snapshot: secondSnapshot }),
      makeComment({ id: "checkout", context: storedContext }),
    ];
    const persisted = JSON.parse(
      JSON.stringify(serializeReviewDraftState({ drafts: { k: comments } })),
    );
    const restored = normalizePersistedState(persisted);
    expect(restored.drafts.k).toEqual(comments);
    const attachment = buildReviewAttachmentSnapshot({
      reviewDraftKey: "k",
      cwd: "/repo/subdir",
      mode: "uncommitted",
      comments: restored.drafts.k!,
    });
    expect(attachment?.commentCount).toBe(3);
    expect(attachment?.attachment.comments.map((comment) => comment.snapshot)).toEqual([
      firstSnapshot,
      secondSnapshot,
      undefined,
    ]);
  });

  it("falls back to the stored line for a comment saved without context", () => {
    const snapshot = buildReviewAttachmentSnapshot({
      reviewDraftKey: "review:key",
      cwd: "/repo",
      mode: "uncommitted",
      comments: [makeComment({ lineNumber: 15, content: "const collapsed = true;" })],
    });
    const line = {
      oldLineNumber: null,
      newLineNumber: 15,
      type: "context",
      content: "const collapsed = true;",
    };
    expect(snapshot?.attachment.comments[0]?.context).toEqual({
      hunkHeader: "",
      targetLine: line,
      lines: [line],
    });
  });
});

describe("buildDiffReviewContext", () => {
  function contextLine(lineNumber: number) {
    return { type: "context" as const, content: `line ${lineNumber}` };
  }

  function makeTwoHunkFile(): ParsedDiffFile {
    return {
      path: "src/example.ts",
      isNew: false,
      isDeleted: false,
      additions: 2,
      deletions: 1,
      status: "ok",
      hunks: [
        {
          oldStart: 1,
          oldCount: 6,
          newStart: 1,
          newCount: 7,
          lines: [
            { type: "header", content: "@@ -1,6 +1,7 @@" },
            contextLine(1),
            contextLine(2),
            contextLine(3),
            { type: "remove", content: "old 4" },
            { type: "add", content: "new 4" },
            { type: "add", content: "new 5" },
            contextLine(5),
            contextLine(6),
          ],
        },
        {
          oldStart: 20,
          oldCount: 4,
          newStart: 21,
          newCount: 4,
          lines: [
            { type: "header", content: "@@ -20,4 +21,4 @@" },
            contextLine(20),
            contextLine(21),
            contextLine(22),
            contextLine(23),
          ],
        },
      ],
    };
  }

  function lineLabels(context: ReviewDraftCommentContext | undefined) {
    return (context?.lines ?? []).map(
      (line) => `${line.oldLineNumber ?? "-"}/${line.newLineNumber ?? "-"}`,
    );
  }

  it("takes the hunk header and surrounding lines of a single line", () => {
    const context = buildDiffReviewContext({
      range: lineRange({ side: "new", lineNumber: 41 }),
      diffFiles: [makeFile()],
    });
    expect(context?.hunkHeader).toBe("@@ -40,4 +40,4 @@");
    expect(context?.targetLine).toEqual({
      oldLineNumber: null,
      newLineNumber: 41,
      type: "add",
      content: "const value = newValue;",
    });
    expect(lineLabels(context)).toEqual(["40/40", "41/-", "-/41", "42/42"]);
  });

  it("spans a mixed-side range from the start's context to the end's context", () => {
    const context = buildDiffReviewContext({
      range: lineRange({ side: "old", lineNumber: 4 }, { side: "new", lineNumber: 5 }),
      diffFiles: [makeTwoHunkFile()],
    });

    expect(context).toMatchObject({
      hunkHeader: "@@ -1,6 +1,7 @@",
      targetLine: { oldLineNumber: null, newLineNumber: 5, type: "add", content: "new 5" },
    });
    expect(lineLabels(context)).toEqual(["1/1", "2/2", "3/3", "4/-", "-/4", "-/5", "5/6", "6/7"]);
  });

  it("spans hunks for a cross-hunk range and keeps context inside the end hunks", () => {
    const context = buildDiffReviewContext({
      range: lineRange({ side: "new", lineNumber: 7 }, { side: "new", lineNumber: 22 }),
      diffFiles: [makeTwoHunkFile()],
    });

    expect(context?.hunkHeader).toBe("@@ -1,6 +1,7 @@");
    expect(lineLabels(context)).toEqual([
      "-/4",
      "-/5",
      "5/6",
      "6/7",
      "20/21",
      "21/22",
      "22/23",
      "23/24",
    ]);
  });

  it("has no context for a range whose start is not in the diff", () => {
    expect(
      buildDiffReviewContext({
        range: lineRange({ side: "new", lineNumber: 15 }, { side: "new", lineNumber: 22 }),
        diffFiles: [makeTwoHunkFile()],
      }),
    ).toBeUndefined();
  });

  it("falls back to the commented line when it is not in the diff", () => {
    const context = buildDiffReviewContext({
      range: lineRange({ side: "new", lineNumber: 15, content: "const collapsed = true;" }),
      diffFiles: [makeTwoHunkFile()],
    });
    expect(context?.hunkHeader).toBe("");
    expect(context?.lines).toEqual([
      {
        oldLineNumber: null,
        newLineNumber: 15,
        type: "context",
        content: "const collapsed = true;",
      },
    ]);
  });

  it("caps range context at 80 lines", () => {
    const lines = Array.from({ length: 120 }, (_, index) => contextLine(index + 1));
    const file: ParsedDiffFile = {
      path: "src/example.ts",
      isNew: false,
      isDeleted: false,
      additions: 0,
      deletions: 0,
      status: "ok",
      hunks: [
        {
          oldStart: 1,
          oldCount: 120,
          newStart: 1,
          newCount: 120,
          lines: [{ type: "header", content: "@@ -1,120 +1,120 @@" }, ...lines],
        },
      ],
    };

    const context = buildDiffReviewContext({
      range: lineRange({ side: "new", lineNumber: 10 }, { side: "new", lineNumber: 110 }),
      diffFiles: [file],
    });

    expect(context?.lines).toHaveLength(80);
    expect(context?.lines[0]?.newLineNumber).toBe(7);
    expect(context?.lines[79]?.newLineNumber).toBe(86);
  });
});

describe("buildFileReviewContext", () => {
  const fileLines = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`);
  function fileContext(start: number, end: number = start) {
    return buildFileReviewContext({
      range: lineRange({ side: "new", lineNumber: start }, { side: "new", lineNumber: end }),
      lineCount: fileLines.length,
      lineText: (lineNumber) => fileLines[lineNumber - 1] ?? "",
    });
  }

  it("takes three file lines on each side as new-side context without a hunk header", () => {
    const context = fileContext(10);
    expect(context?.hunkHeader).toBe("");
    expect(context?.targetLine).toEqual({
      oldLineNumber: null,
      newLineNumber: 10,
      type: "context",
      content: "line 10",
    });
    expect(context?.lines.map((line) => line.newLineNumber)).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(context?.lines.every((line) => line.oldLineNumber === null)).toBe(true);
  });

  it("clamps the radius at the file edges", () => {
    expect(fileContext(1)?.lines.map((line) => line.newLineNumber)).toEqual([1, 2, 3, 4]);
    expect(fileContext(120)?.lines.map((line) => line.newLineNumber)).toEqual([117, 118, 119, 120]);
  });

  it("covers a range plus radius and caps at 80 lines", () => {
    expect(fileContext(5, 8)?.lines.map((line) => line.newLineNumber)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    const capped = fileContext(10, 110);
    expect(capped?.lines).toHaveLength(80);
    expect(capped?.lines[0]?.newLineNumber).toBe(7);
    expect(capped?.targetLine.newLineNumber).toBe(110);
  });

  it("has no context for a line past the end of the file", () => {
    expect(fileContext(121)).toBeUndefined();
  });
});
