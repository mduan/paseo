import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";
import { InlineReviewThread, useInlineReviewController } from "@/review";
import { buildFileReviewContext } from "@/review/context";
import type { ReviewLineRange } from "@/review/range";
import {
  docLineText,
  fileLineDragRange,
  fileLineReviewTarget,
  fileReviewCompartment,
  fileReviewExtension,
  fileReviewHighlightLines,
  fileReviewThreads,
  resolveFileReviewPress,
  setFileReviewDecorations,
  type FileReviewGutterHandlers,
} from "./review-comments.web";

/** Where the file's review comments are kept. Absent when the file cannot take comments. */
export interface FileReviewConfig {
  reviewDraftKey: string;
  /** Workspace-relative, like diff file paths. */
  filePath: string;
}

/** Measures the content area so threads span the visible width beside the gutters. */
function useContentViewport(view: EditorView) {
  const [viewport, setViewport] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const gutters = view.dom.querySelector(".cm-gutters");
      const left = gutters instanceof HTMLElement ? gutters.offsetWidth : 0;
      const width = Math.max(0, view.scrollDOM.clientWidth - left);
      setViewport((current) =>
        current.left === left && current.width === width ? current : { left, width },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(view.scrollDOM);
    const gutters = view.dom.querySelector(".cm-gutters");
    if (gutters) observer.observe(gutters);
    return () => observer.disconnect();
  }, [view]);
  return viewport;
}

/**
 * Inline review comments in a file viewer's CodeMirror: fills the review compartment and renders
 * the threads into the editor through portals, so they stay in the app's React tree.
 */
export function FileReviewLayer({ view, review }: { view: EditorView; review: FileReviewConfig }) {
  const { filePath } = review;
  const buildContext = useCallback(
    (range: ReviewLineRange) =>
      buildFileReviewContext({
        range,
        lineCount: view.state.doc.lines,
        lineText: (lineNumber) => docLineText(view.state.doc, lineNumber),
      }),
    [view],
  );
  const actions = useInlineReviewController({
    reviewDraftKey: review.reviewDraftKey,
    buildContext,
  });
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  useLayoutEffect(() => {
    const targetAt = (lineNumber: number) =>
      fileLineReviewTarget({
        filePath: filePathRef.current,
        lineNumber,
        content: docLineText(view.state.doc, lineNumber),
      });
    const handlers: FileReviewGutterHandlers = {
      press({ part, lineNumber }) {
        const current = actionsRef.current;
        const pinnedLine = fileReviewHighlightLines({
          filePath: filePathRef.current,
          highlight: current.highlight,
          lineCount: view.state.doc.lines,
        })?.to;
        const action = resolveFileReviewPress({ part, lineNumber, pinnedLine });
        if (action === "toggleHighlight") current.onToggleHighlight(targetAt(lineNumber));
        else if (action === "startHighlightComment") current.onStartHighlightComment();
        else current.onStartComment(targetAt(lineNumber));
      },
      drag({ anchorLine, lineNumber }) {
        actionsRef.current.onHighlight(
          fileLineDragRange({ anchor: targetAt(anchorLine), target: targetAt(lineNumber) }),
        );
      },
    };
    view.dispatch({ effects: fileReviewCompartment.reconfigure(fileReviewExtension(handlers)) });
    return () => view.dispatch({ effects: fileReviewCompartment.reconfigure([]) });
  }, [view]);

  const { commentsByTarget, editor, highlight } = actions;
  const threads = useMemo(
    () =>
      fileReviewThreads({ filePath, actions: { commentsByTarget, editor }, doc: view.state.doc }),
    [commentsByTarget, editor, filePath, view],
  );
  // One host per thread for as long as the thread exists, whether or not CodeMirror shows it.
  const [hostCache] = useState(() => new Map<string, HTMLElement>());
  const hosts = useMemo(() => {
    const next = new Map<string, HTMLElement>();
    for (const thread of threads) {
      next.set(
        thread.target.key,
        hostCache.get(thread.target.key) ?? document.createElement("div"),
      );
    }
    hostCache.clear();
    for (const [key, host] of next) hostCache.set(key, host);
    return next;
  }, [hostCache, threads]);
  const viewport = useContentViewport(view);

  useLayoutEffect(() => {
    const lines = fileReviewHighlightLines({
      filePath,
      highlight,
      lineCount: view.state.doc.lines,
    });
    view.dispatch({
      effects: setFileReviewDecorations.of({
        threads,
        highlight: lines,
        pinnedLine: lines?.to,
        hosts,
        stickyLeft: viewport.left,
      }),
    });
  }, [filePath, highlight, hosts, threads, view, viewport.left]);

  return (
    <>
      {threads.map((thread) => {
        const host = hosts.get(thread.target.key);
        return host
          ? createPortal(
              <InlineReviewThread
                reviewTarget={thread.target}
                reviewActions={actions}
                height={thread.height}
                viewportWidth={viewport.width}
              />,
              host,
              thread.target.key,
            )
          : null;
      })}
    </>
  );
}
