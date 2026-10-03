/**
 * @vitest-environment jsdom
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { lineTargetHighlight, revealLineTarget } from "./line-target.web";

const views: EditorView[] = [];

function createView(): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: ["one", "two", "three", "four"].join("\n"),
      extensions: [lineTargetHighlight],
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

function tintedLines(view: EditorView): number[] {
  const lines: number[] = [];
  view.state.field(lineTargetHighlight).between(0, view.state.doc.length, (from) => {
    lines.push(view.state.doc.lineAt(from).number);
  });
  return lines;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe("revealLineTarget", () => {
  it("tints the range, clamped to the document, and puts the cursor at its start", () => {
    const view = createView();
    revealLineTarget(view, { lineStart: 3, lineEnd: 9 });
    expect(tintedLines(view)).toEqual([3, 4]);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from);
  });

  it("keeps the tint through programmatic changes and clears it on user input", () => {
    const view = createView();
    revealLineTarget(view, { lineStart: 2 });
    view.dispatch({ changes: { from: 0, insert: "zero\n" } });
    expect(tintedLines(view)).toEqual([3]);
    view.dispatch({ selection: { anchor: 0 }, userEvent: "select.pointer" });
    expect(tintedLines(view)).toEqual([]);
  });
});
