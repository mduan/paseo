import { StateEffect, StateField, Transaction, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { WorkspaceFileLocation } from "@/workspace/file-open";

const setLineTarget = StateEffect.define<{ lineStart: number; lineEnd: number }>();
const lineTargetDecoration = Decoration.line({ class: "cm-line-target" });

function decorateLines(state: EditorState, lineStart: number, lineEnd: number): DecorationSet {
  const ranges = [];
  for (let line = lineStart; line <= lineEnd; line++) {
    ranges.push(lineTargetDecoration.range(state.doc.line(line).from));
  }
  return Decoration.set(ranges);
}

/** Tints the lines a file link targets until the user clicks, moves, or edits. */
export const lineTargetHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(lines, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setLineTarget)) {
        return decorateLines(tr.state, effect.value.lineStart, effect.value.lineEnd);
      }
    }
    if (tr.annotation(Transaction.userEvent)) return Decoration.none;
    return lines.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Moves the cursor to the target lines, tints them, and scrolls them to the center. */
export function revealLineTarget(
  view: EditorView,
  location: Pick<WorkspaceFileLocation, "lineStart" | "lineEnd">,
): void {
  if (!location.lineStart) return;
  const { doc } = view.state;
  const lineStart = Math.min(location.lineStart, doc.lines);
  const lineEnd = Math.max(lineStart, Math.min(location.lineEnd ?? lineStart, doc.lines));
  const from = doc.line(lineStart).from;
  view.dispatch({
    selection: { anchor: from },
    effects: [
      setLineTarget.of({ lineStart, lineEnd }),
      EditorView.scrollIntoView(from, { y: "center" }),
    ],
  });
}
