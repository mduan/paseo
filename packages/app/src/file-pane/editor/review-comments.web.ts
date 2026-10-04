import {
  Compartment,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutter,
  type DecorationSet,
} from "@codemirror/view";
import { hasPointerDragStarted } from "@/git/diff-document/pointer-gesture";
import { getInlineReviewThreadState, type InlineReviewActions } from "@/review/geometry";
import type { ReviewLineRange } from "@/review/range";
import { buildReviewableDiffTargetKey, type ReviewableDiffTarget } from "@/utils/diff-layout";

/** Holds the review extension; the review layer fills it while comments are enabled. */
export const fileReviewCompartment = new Compartment();

export enum FileReviewGutterPart {
  LineNumber = "lineNumber",
  AddButton = "addButton",
}

export interface FileReviewThread {
  target: ReviewableDiffTarget;
  height: number;
}

export interface FileReviewLines {
  from: number;
  to: number;
}

export interface FileReviewDecorationsInput {
  threads: readonly FileReviewThread[];
  highlight?: FileReviewLines;
  /** The line whose add button stays visible: the bottom line of the highlight. */
  pinnedLine?: number;
  /** React-owned thread hosts by target key, so a thread outlives its widget's DOM. */
  hosts: ReadonlyMap<string, HTMLElement>;
  /** Left inset that keeps threads beside the gutters when the content scrolls sideways. */
  stickyLeft: number;
}

export interface FileReviewGutterHandlers {
  press(input: { part: FileReviewGutterPart; lineNumber: number }): void;
  drag(input: { anchorLine: number; lineNumber: number }): void;
}

/** A whole-file line as a review target. File lines are always the new side. */
export function fileLineReviewTarget(input: {
  filePath: string;
  lineNumber: number;
  content: string;
}): ReviewableDiffTarget {
  return {
    key: buildReviewableDiffTargetKey({
      filePath: input.filePath,
      side: "new",
      lineNumber: input.lineNumber,
    }),
    filePath: input.filePath,
    hunkHeader: "",
    hunkIndex: 0,
    lineIndex: input.lineNumber - 1,
    oldLineNumber: null,
    newLineNumber: input.lineNumber,
    side: "new",
    lineNumber: input.lineNumber,
    lineType: "context",
    content: input.content,
  };
}

export function docLineText(doc: Text, lineNumber: number): string {
  return lineNumber >= 1 && lineNumber <= doc.lines ? doc.line(lineNumber).text : "";
}

/** The range from the drag anchor to the line under the pointer, top line first. */
export function fileLineDragRange(input: {
  anchor: ReviewableDiffTarget;
  target: ReviewableDiffTarget;
}): ReviewLineRange {
  return input.target.lineNumber < input.anchor.lineNumber
    ? { start: input.target, end: input.anchor }
    : { start: input.anchor, end: input.target };
}

/** The highlighted lines of this file, or nothing when the highlight is elsewhere. */
export function fileReviewHighlightLines(input: {
  filePath: string;
  highlight: ReviewLineRange | undefined;
  lineCount: number;
}): FileReviewLines | undefined {
  const { highlight } = input;
  if (!highlight) return undefined;
  const ends = [highlight.start, highlight.end];
  if (ends.some((end) => end.filePath !== input.filePath || end.side !== "new")) return undefined;
  const from = Math.min(highlight.start.lineNumber, highlight.end.lineNumber);
  const to = Math.min(
    input.lineCount,
    Math.max(highlight.start.lineNumber, highlight.end.lineNumber),
  );
  return from <= to ? { from, to } : undefined;
}

/**
 * Threads to show under this file's lines: commented lines and the open editor's line. Comments
 * keep the line number they were made on; the decorations skip lines the file no longer has.
 */
export function fileReviewThreads(input: {
  filePath: string;
  actions: Pick<InlineReviewActions, "commentsByTarget" | "editor">;
  doc: Text;
}): FileReviewThread[] {
  const lineNumbers = new Set<number>();
  for (const comments of input.actions.commentsByTarget.values()) {
    const [comment] = comments;
    if (comment?.filePath === input.filePath && comment.side === "new") {
      lineNumbers.add(comment.lineNumber);
    }
  }
  const { editor } = input.actions;
  if (editor?.target.filePath === input.filePath && editor.target.side === "new") {
    lineNumbers.add(editor.target.lineNumber);
  }
  const threads: FileReviewThread[] = [];
  for (const lineNumber of [...lineNumbers].sort((left, right) => left - right)) {
    const target = fileLineReviewTarget({
      filePath: input.filePath,
      lineNumber,
      content: docLineText(input.doc, lineNumber),
    });
    const state = getInlineReviewThreadState({
      reviewTarget: target,
      reviewActions: input.actions,
    });
    if (state) threads.push({ target, height: state.height });
  }
  return threads;
}

/** A gutter click opens the highlight's editor from its pinned add button, like the diff. */
export function resolveFileReviewPress(input: {
  part: FileReviewGutterPart;
  lineNumber: number;
  pinnedLine: number | undefined;
}): "toggleHighlight" | "startHighlightComment" | "startComment" {
  if (input.part === FileReviewGutterPart.LineNumber) return "toggleHighlight";
  return input.lineNumber === input.pinnedLine ? "startHighlightComment" : "startComment";
}

export const setFileReviewDecorations = StateEffect.define<FileReviewDecorationsInput>();
const setHoveredLine = StateEffect.define<number | undefined>();

const EMPTY_INPUT: FileReviewDecorationsInput = {
  threads: [],
  hosts: new Map(),
  stickyLeft: 0,
};

const reviewInput = StateField.define<FileReviewDecorationsInput>({
  create: () => EMPTY_INPUT,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFileReviewDecorations)) return effect.value;
    }
    return value;
  },
});

const hoveredLine = StateField.define<number | undefined>({
  create: () => undefined,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHoveredLine)) return effect.value;
    }
    return tr.docChanged ? undefined : value;
  },
});

class ReviewThreadWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly height: number,
    readonly host: HTMLElement | undefined,
    readonly stickyLeft: number,
  ) {
    super();
  }

  eq(other: ReviewThreadWidget): boolean {
    return (
      other.key === this.key &&
      other.height === this.height &&
      other.host === this.host &&
      other.stickyLeft === this.stickyLeft
    );
  }

  // The host moves into each new wrapper, so the React thread and its draft text survive the
  // widget leaving the viewport or being rebuilt.
  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-review-thread";
    wrapper.style.position = "sticky";
    wrapper.style.left = `${this.stickyLeft}px`;
    wrapper.style.minHeight = `${this.height}px`;
    if (this.host) wrapper.appendChild(this.host);
    return wrapper;
  }

  get estimatedHeight(): number {
    return this.height;
  }

  // Typing, clicks, and selection in the comment box belong to it, not to CodeMirror or vim.
  ignoreEvent(): boolean {
    return true;
  }
}

const highlightLine = Decoration.line({ class: "cm-review-highlight" });

/** Line numbers are kept as made; edits do not move threads or highlights. */
function buildDecorations(state: EditorState): DecorationSet {
  const input = state.field(reviewInput);
  const { doc } = state;
  const ranges: Range<Decoration>[] = [];
  const widgetsByLine = new Map(input.threads.map((thread) => [thread.target.lineNumber, thread]));
  const highlightEnd = input.highlight ? Math.min(input.highlight.to, doc.lines) : 0;
  const lastLine = Math.max(highlightEnd, ...widgetsByLine.keys());
  for (let lineNumber = 1; lineNumber <= Math.min(lastLine, doc.lines); lineNumber += 1) {
    const isHighlighted =
      input.highlight !== undefined &&
      lineNumber >= input.highlight.from &&
      lineNumber <= highlightEnd;
    const thread = widgetsByLine.get(lineNumber);
    if (!isHighlighted && !thread) continue;
    const line = doc.line(lineNumber);
    if (isHighlighted) ranges.push(highlightLine.range(line.from));
    if (thread) {
      const widget = new ReviewThreadWidget(
        thread.target.key,
        thread.height,
        input.hosts.get(thread.target.key),
        input.stickyLeft,
      );
      ranges.push(Decoration.widget({ widget, block: true, side: 1 }).range(line.to));
    }
  }
  return Decoration.set(ranges, true);
}

const reviewDecorations = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(value, tr) {
    const changed =
      tr.docChanged || tr.effects.some((effect) => effect.is(setFileReviewDecorations));
    return changed ? buildDecorations(tr.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

class AddCommentMarker extends GutterMarker {
  toDOM(): Node {
    const button = document.createElement("div");
    button.className = "cm-review-add";
    button.setAttribute("aria-hidden", "true");
    button.textContent = "+";
    return button;
  }
}

const addCommentMarker = new AddCommentMarker();

class SpacerMarker extends GutterMarker {
  toDOM(): Node {
    const spacer = document.createElement("div");
    spacer.className = "cm-review-add-spacer";
    return spacer;
  }
}

const reviewGutter = gutter({
  class: "cm-review-gutter",
  lineMarker(view, line) {
    const lineNumber = view.state.doc.lineAt(line.from).number;
    const isShown =
      lineNumber === view.state.field(hoveredLine) ||
      lineNumber === view.state.field(reviewInput).pinnedLine;
    return isShown ? addCommentMarker : null;
  },
  lineMarkerChange: (update) =>
    update.startState.field(hoveredLine) !== update.state.field(hoveredLine) ||
    update.startState.field(reviewInput).pinnedLine !== update.state.field(reviewInput).pinnedLine,
  initialSpacer: () => new SpacerMarker(),
});

interface LineDrag {
  anchorLine: number;
  part: FileReviewGutterPart;
  startX: number;
  startY: number;
  moved: boolean;
}

function lineAtClientY(view: EditorView, clientY: number): number {
  const block = view.lineBlockAtHeight(clientY - view.documentTop);
  return view.state.doc.lineAt(block.from).number;
}

function gutterPartAt(target: EventTarget | null): FileReviewGutterPart | undefined {
  if (!(target instanceof Element)) return undefined;
  if (target.closest(".cm-review-gutter")) return FileReviewGutterPart.AddButton;
  if (target.closest(".cm-lineNumbers")) return FileReviewGutterPart.LineNumber;
  return undefined;
}

function isInReviewThread(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(".cm-review-thread"));
}

/** Gutter presses and drags, and the hovered line that shows the add button. */
function reviewPointer(handlers: FileReviewGutterHandlers) {
  return ViewPlugin.define((view) => {
    let drag: LineDrag | undefined;
    const setHover = (lineNumber: number | undefined) => {
      if (view.state.field(hoveredLine) !== lineNumber) {
        view.dispatch({ effects: setHoveredLine.of(lineNumber) });
      }
    };
    const onMouseMove = (event: MouseEvent) => {
      if (drag) return;
      setHover(isInReviewThread(event.target) ? undefined : lineAtClientY(view, event.clientY));
    };
    const onMouseLeave = () => setHover(undefined);
    const onWindowMouseMove = (event: MouseEvent) => {
      if (!drag) return;
      drag.moved = hasPointerDragStarted({
        startX: drag.startX,
        startY: drag.startY,
        x: event.clientX,
        y: event.clientY,
        alreadyDragging: drag.moved,
      });
      if (!drag.moved) return;
      setHover(undefined);
      handlers.drag({
        anchorLine: drag.anchorLine,
        lineNumber: lineAtClientY(view, event.clientY),
      });
    };
    const onWindowMouseUp = () => {
      const current = drag;
      drag = undefined;
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
      if (current && !current.moved) {
        handlers.press({ part: current.part, lineNumber: current.anchorLine });
      }
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const part = gutterPartAt(event.target);
      if (!part) return;
      event.preventDefault();
      drag = {
        anchorLine: lineAtClientY(view, event.clientY),
        part,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      window.addEventListener("mousemove", onWindowMouseMove);
      window.addEventListener("mouseup", onWindowMouseUp);
    };
    view.dom.addEventListener("mousemove", onMouseMove);
    view.dom.addEventListener("mouseleave", onMouseLeave);
    view.dom.addEventListener("mousedown", onMouseDown);
    return {
      destroy() {
        view.dom.removeEventListener("mousemove", onMouseMove);
        view.dom.removeEventListener("mouseleave", onMouseLeave);
        view.dom.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onWindowMouseMove);
        window.removeEventListener("mouseup", onWindowMouseUp);
      },
    };
  });
}

const reviewTheme = EditorView.baseTheme({
  ".cm-review-gutter .cm-gutterElement": { cursor: "pointer", display: "flex" },
  ".cm-lineNumbers .cm-gutterElement": { cursor: "pointer" },
  ".cm-review-add, .cm-review-add-spacer": { width: "18px" },
  ".cm-review-add": {
    alignSelf: "center",
    height: "18px",
    borderRadius: "4px",
    lineHeight: "18px",
    textAlign: "center",
    fontWeight: "700",
  },
  ".cm-review-thread": { boxSizing: "border-box" },
});

/** Review comments on whole-file lines, in the file viewer's CodeMirror. */
export function fileReviewExtension(handlers: FileReviewGutterHandlers): Extension {
  return [
    reviewInput,
    hoveredLine,
    reviewDecorations,
    reviewGutter,
    reviewPointer(handlers),
    reviewTheme,
  ];
}
