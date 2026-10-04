/**
 * @vitest-environment jsdom
 */
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewDraftComment } from "@/review";
import type { InlineReviewEditorState } from "@/review/geometry";
import {
  FileReviewGutterPart,
  fileLineDragRange,
  fileLineReviewTarget,
  fileReviewCompartment,
  fileReviewExtension,
  fileReviewHighlightLines,
  fileReviewThreads,
  resolveFileReviewPress,
  setFileReviewDecorations,
} from "./review-comments.web";

const FILE = "src/example.ts";
const doc = Text.of(["one", "two", "three", "four", "five"]);

function target(lineNumber: number) {
  return fileLineReviewTarget({ filePath: FILE, lineNumber, content: `line ${lineNumber}` });
}

function comment(overrides: Partial<ReviewDraftComment>): ReviewDraftComment {
  return {
    id: "comment-1",
    filePath: FILE,
    side: "new",
    lineNumber: 2,
    body: "Note.",
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
    ...overrides,
  };
}

function editorAt(lineNumber: number): InlineReviewEditorState {
  return { target: target(lineNumber), commentId: null, body: "", focusRequestId: 0 };
}

describe("fileLineReviewTarget", () => {
  it("is a new-side context line keyed like a diff target", () => {
    expect(target(3)).toMatchObject({
      key: `${FILE}:new:3`,
      side: "new",
      lineNumber: 3,
      oldLineNumber: null,
      newLineNumber: 3,
      hunkHeader: "",
      content: "line 3",
    });
  });
});

describe("fileLineDragRange", () => {
  it("orders the range top line first in either drag direction", () => {
    expect(fileLineDragRange({ anchor: target(4), target: target(2) })).toEqual({
      start: target(2),
      end: target(4),
    });
    expect(fileLineDragRange({ anchor: target(2), target: target(4) })).toEqual({
      start: target(2),
      end: target(4),
    });
  });
});

describe("fileReviewHighlightLines", () => {
  it("returns this file's highlighted lines clamped to the file", () => {
    expect(
      fileReviewHighlightLines({
        filePath: FILE,
        highlight: { start: target(2), end: target(9) },
        lineCount: 5,
      }),
    ).toEqual({ from: 2, to: 5 });
  });

  it("ignores highlights in other files, on the old side, or past the end", () => {
    const other = { ...target(2), filePath: "src/other.ts" };
    expect(
      fileReviewHighlightLines({
        filePath: FILE,
        highlight: { start: other, end: other },
        lineCount: 5,
      }),
    ).toBeUndefined();
    const oldSide = { ...target(2), side: "old" as const };
    expect(
      fileReviewHighlightLines({
        filePath: FILE,
        highlight: { start: oldSide, end: target(3) },
        lineCount: 5,
      }),
    ).toBeUndefined();
    expect(
      fileReviewHighlightLines({
        filePath: FILE,
        highlight: { start: target(7), end: target(8) },
        lineCount: 5,
      }),
    ).toBeUndefined();
  });
});

describe("fileReviewThreads", () => {
  it("lists this file's new-side commented lines and the open editor, in line order", () => {
    const commentsByTarget = new Map([
      [`${FILE}:new:4`, [comment({ id: "a", lineNumber: 4 })]],
      [`${FILE}:old:2`, [comment({ id: "b", side: "old", lineNumber: 2 })]],
      ["src/other.ts:new:1", [comment({ id: "c", filePath: "src/other.ts", lineNumber: 1 })]],
    ]);
    const threads = fileReviewThreads({
      filePath: FILE,
      actions: { commentsByTarget, editor: editorAt(1) },
      doc,
    });
    expect(threads.map((thread) => thread.target.lineNumber)).toEqual([1, 4]);
    expect(threads[1]?.target.content).toBe("four");
    expect(threads.every((thread) => thread.height > 0)).toBe(true);
  });
});

describe("resolveFileReviewPress", () => {
  it("toggles the highlight from the line number and comments from the add button", () => {
    expect(
      resolveFileReviewPress({
        part: FileReviewGutterPart.LineNumber,
        lineNumber: 2,
        pinnedLine: 2,
      }),
    ).toBe("toggleHighlight");
    expect(
      resolveFileReviewPress({
        part: FileReviewGutterPart.AddButton,
        lineNumber: 2,
        pinnedLine: 2,
      }),
    ).toBe("startHighlightComment");
    expect(
      resolveFileReviewPress({
        part: FileReviewGutterPart.AddButton,
        lineNumber: 3,
        pinnedLine: 2,
      }),
    ).toBe("startComment");
  });
});

describe("fileReviewExtension", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
  });

  function createView(): EditorView {
    const view = new EditorView({
      state: EditorState.create({
        doc: doc.toString(),
        extensions: [
          fileReviewCompartment.of(fileReviewExtension({ press: () => {}, drag: () => {} })),
        ],
      }),
      parent: document.body,
    });
    views.push(view);
    return view;
  }

  it("moves a thread's host into its widget and skips lines the file no longer has", () => {
    const view = createView();
    const host = document.createElement("div");
    host.dataset.testid = "thread-host";
    const missingHost = document.createElement("div");
    view.dispatch({
      effects: setFileReviewDecorations.of({
        threads: [
          { target: target(2), height: 100 },
          { target: target(9), height: 100 },
        ],
        highlight: { from: 1, to: 2 },
        pinnedLine: 2,
        hosts: new Map([
          [target(2).key, host],
          [target(9).key, missingHost],
        ]),
        stickyLeft: 0,
      }),
    });

    expect(host.parentElement?.classList.contains("cm-review-thread")).toBe(true);
    expect(missingHost.parentElement).toBeNull();
    expect(view.dom.querySelectorAll(".cm-review-highlight")).toHaveLength(2);

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "only" } });
    expect(view.dom.querySelectorAll(".cm-review-thread")).toHaveLength(0);
  });
});
