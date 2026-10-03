import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { buildReviewAttachmentSnapshot, buildReviewDraftKey } from "./store";
import {
  addCommentToState,
  clearReviewInState,
  deleteCommentFromState,
  normalizePersistedState,
  type ReviewDraftComment,
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
  it("scopes by server, workspace-or-cwd, diff mode, base ref, and whitespace mode", () => {
    const base = buildReviewDraftKey({
      serverId: " local ",
      workspaceId: " workspace-1 ",
      cwd: "/repo",
      mode: "base",
      baseRef: " main ",
      ignoreWhitespace: false,
    });

    expect(base).toBe(
      "review:server=local:workspace=workspace-1:mode=base:base=main:ignoreWhitespace=false",
    );
    expect(
      buildReviewDraftKey({
        serverId: "local",
        workspaceId: "workspace-1",
        cwd: "/repo",
        mode: "base",
        baseRef: "main",
        ignoreWhitespace: true,
      }),
    ).not.toBe(base);
    expect(
      buildReviewDraftKey({
        serverId: "local",
        workspaceId: null,
        cwd: "/repo/",
        mode: "base",
        baseRef: "main",
        ignoreWhitespace: false,
      }),
    ).toBe("review:server=local:cwd=%2Frepo:mode=base:base=main:ignoreWhitespace=false");
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

describe("buildReviewAttachmentSnapshot", () => {
  it("builds a bounded workspace review attachment and skips missing targets", () => {
    const snapshot = buildReviewAttachmentSnapshot({
      reviewDraftKey: "review:key",
      cwd: "/repo",
      mode: "base",
      baseRef: "main",
      comments: [
        {
          id: "comment-1",
          filePath: "src/example.ts",
          side: "new",
          lineNumber: 41,
          body: "Please simplify this.",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        {
          id: "comment-2",
          filePath: "src/missing.ts",
          side: "new",
          lineNumber: 99,
          body: "This target is stale.",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
      ],
      diffFiles: [makeFile()],
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
        baseRef: "main",
        comments: [
          {
            filePath: "src/example.ts",
            side: "new",
            lineNumber: 41,
            body: "Please simplify this.",
            context: {
              hunkHeader: "@@ -40,4 +40,4 @@",
              targetLine: {
                oldLineNumber: null,
                newLineNumber: 41,
                type: "add",
                content: "const value = newValue;",
              },
              lines: [
                {
                  oldLineNumber: 40,
                  newLineNumber: 40,
                  type: "context",
                  content: "const before = true;",
                },
                {
                  oldLineNumber: 41,
                  newLineNumber: null,
                  type: "remove",
                  content: "const value = oldValue;",
                },
                {
                  oldLineNumber: null,
                  newLineNumber: 41,
                  type: "add",
                  content: "const value = newValue;",
                },
                {
                  oldLineNumber: 42,
                  newLineNumber: 42,
                  type: "context",
                  content: "return value;",
                },
              ],
            },
          },
        ],
      },
    });
  });

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

  function snapshotComments(comments: ReviewDraftComment[], diffFiles: ParsedDiffFile[]) {
    return (
      buildReviewAttachmentSnapshot({
        reviewDraftKey: "review:key",
        cwd: "/repo",
        mode: "uncommitted",
        comments,
        diffFiles,
      })?.attachment.comments ?? []
    );
  }

  function lineLabels(comment: {
    context: { lines: { oldLineNumber: number | null; newLineNumber: number | null }[] };
  }) {
    return comment.context.lines.map(
      (line) => `${line.oldLineNumber ?? "-"}/${line.newLineNumber ?? "-"}`,
    );
  }

  it("spans a mixed-side range from the start's context to the end's context", () => {
    const [comment] = snapshotComments(
      [makeComment({ startSide: "old", startLineNumber: 4, side: "new", lineNumber: 5 })],
      [makeTwoHunkFile()],
    );

    expect(comment).toMatchObject({
      side: "new",
      lineNumber: 5,
      startSide: "old",
      startLineNumber: 4,
      context: {
        hunkHeader: "@@ -1,6 +1,7 @@",
        targetLine: { oldLineNumber: null, newLineNumber: 5, type: "add", content: "new 5" },
      },
    });
    expect(lineLabels(comment!)).toEqual(["1/1", "2/2", "3/3", "4/-", "-/4", "-/5", "5/6", "6/7"]);
  });

  it("spans hunks for a cross-hunk range and keeps context inside the end hunks", () => {
    const [comment] = snapshotComments(
      [makeComment({ startSide: "new", startLineNumber: 7, side: "new", lineNumber: 22 })],
      [makeTwoHunkFile()],
    );

    expect(comment?.context.hunkHeader).toBe("@@ -1,6 +1,7 @@");
    expect(lineLabels(comment!)).toEqual([
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

  it("drops a range comment when either end left the diff", () => {
    expect(
      snapshotComments(
        [makeComment({ startSide: "new", startLineNumber: 15, side: "new", lineNumber: 22 })],
        [makeTwoHunkFile()],
      ),
    ).toEqual([]);
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

    const [comment] = snapshotComments(
      [makeComment({ startSide: "new", startLineNumber: 10, side: "new", lineNumber: 110 })],
      [file],
    );

    expect(comment?.context.lines).toHaveLength(80);
    expect(comment?.context.lines[0]?.newLineNumber).toBe(7);
    expect(comment?.context.lines[79]?.newLineNumber).toBe(86);
  });
});
