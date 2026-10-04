// @vitest-environment jsdom
import "@/test/window-local-storage";
import { i18n as testI18n } from "@/i18n/i18next";
import { act, fireEvent, render, renderHook, cleanup } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { useReviewDraftStore, type ReviewDraftComment } from "./store";
import { buildReviewableDiffTargetKey, type ReviewableDiffTarget } from "@/utils/diff-layout";
import {
  getInlineReviewThreadState,
  getInlineReviewThreadViewportStyle,
  getSplitInlineReviewThreadState,
  groupInlineReviewCommentsByTarget,
  InlineReviewEditor,
  InlineReviewGutterCell,
  InlineReviewThread,
  SMALL_ACTION_HIT_SLOP,
  useInlineReviewController,
  type InlineReviewActions,
} from "./index";
import { INLINE_REVIEW_COMMENT_HEIGHT } from "./geometry";
import { singleLineRange } from "./range";

void testI18n;

const { theme, pressablePropsByLabel, shortcutOs } = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false });
  return {
    theme: {
      spacing: { 1: 4, 2: 8, 3: 12 },
      borderWidth: { 1: 1 },
      borderRadius: { base: 4, md: 6, lg: 8, xl: 12, full: 999 },
      opacity: { 50: 0.5 },
      fontSize: { xs: 11, sm: 13 },
      fontWeight: { normal: "400", medium: "500" },
      lineHeight: { diff: 18 },
      colors: {
        accent: "#0a84ff",
        accentForeground: "#fff",
        border: "#555",
        destructive: "#ff453a",
        foreground: "#fff",
        foregroundMuted: "#aaa",
        surface1: "#111",
        surface2: "#222",
        surface3: "#333",
        palette: { white: "#fff" },
      },
    },
    pressablePropsByLabel: new Map<string, Record<string, unknown>>(),
    shortcutOs: { current: "non-mac" as "mac" | "non-mac" },
  };
});

vi.mock("@/utils/shortcut-platform", () => ({ getShortcutOs: () => shortcutOs.current }));

vi.mock("react-native", async (importOriginal) => {
  const ReactModule = await import("react");
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
      ...props
    }: {
      accessibilityLabel?: string;
      children?:
        | React.ReactNode
        | ((state: { hovered: boolean; pressed: boolean }) => React.ReactNode);
      onPress?: () => void;
      [key: string]: unknown;
    }) => {
      if (accessibilityLabel) {
        pressablePropsByLabel.set(accessibilityLabel, props);
      }
      const resolvedChildren =
        typeof children === "function" ? children({ hovered: false, pressed: false }) : children;
      return ReactModule.createElement(
        "button",
        {
          "aria-label": accessibilityLabel,
          "data-testid": typeof props.testID === "string" ? props.testID : undefined,
          disabled: props.disabled === true,
          onClick: onPress,
          type: "button",
        },
        resolvedChildren,
      );
    },
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  withUnistyles: <T,>(component: T) => component,
  useUnistyles: () => ({ theme, rt: { breakpoint: "md" } }),
}));

vi.mock("@/constants/platform", () => ({
  getIsElectron: () => false,
  getIsElectronMac: () => false,
  isNative: false,
  isWeb: true,
}));

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": name });
  return {
    Check: createIcon("Check"),
    CircleDot: createIcon("CircleDot"),
    Pencil: createIcon("Pencil"),
    Plus: createIcon("Plus"),
    Trash2: createIcon("Trash2"),
    X: createIcon("X"),
  };
});

function target(overrides: Partial<ReviewableDiffTarget> = {}): ReviewableDiffTarget {
  return {
    filePath: "src/example.ts",
    hunkHeader: "@@ -1,2 +1,2 @@",
    hunkIndex: 0,
    lineIndex: 2,
    oldLineNumber: null,
    newLineNumber: 2,
    side: "new",
    lineNumber: 2,
    lineType: "add",
    content: "const value = next;",
    ...overrides,
    key: buildReviewableDiffTargetKey({
      filePath: overrides.filePath ?? "src/example.ts",
      side: overrides.side ?? "new",
      lineNumber: overrides.lineNumber ?? 2,
    }),
  };
}

const EMPTY_COMMENTS: ReviewDraftComment[] = [];
const noContext = () => undefined;
const COMMENT_LIST: ReviewDraftComment[] = [comment()];

function buildReviewActions(overrides: Partial<InlineReviewActions> = {}): InlineReviewActions {
  return {
    commentsByTarget: new Map(),
    commentHeights: new Map(),
    editor: null,
    onHighlight: vi.fn(),
    onToggleHighlight: vi.fn(),
    onStartComment: vi.fn(),
    onStartHighlightComment: vi.fn(),
    onEditComment: vi.fn(),
    onEditorBodyChange: vi.fn(),
    onEditorHeightChange: vi.fn(),
    onCommentHeightChange: vi.fn(),
    onCancelEditor: vi.fn(),
    onSaveEditor: vi.fn(),
    onDeleteComment: vi.fn(),
    ...overrides,
  };
}

function comment(overrides: Partial<ReviewDraftComment> = {}): ReviewDraftComment {
  return {
    id: "comment-1",
    filePath: "src/example.ts",
    side: "new",
    lineNumber: 2,
    body: "Please simplify this.",
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("useInlineReviewController", () => {
  beforeEach(() => {
    useReviewDraftStore.setState({ drafts: {} });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("owns draft comment add, edit, delete, cancel, and key-change editor reset", () => {
    const reviewTarget = target();
    const firstKey = "review:key-1";
    const secondKey = "review:key-2";
    const { result, rerender } = renderHook(
      ({ reviewDraftKey }) =>
        useInlineReviewController({ reviewDraftKey, buildContext: noContext }),
      { initialProps: { reviewDraftKey: firstKey } },
    );

    act(() => result.current.onStartComment(reviewTarget));
    expect(result.current.editor).toEqual({
      target: reviewTarget,
      commentId: null,
      body: "",
      focusRequestId: 0,
    });

    act(() => result.current.onSaveEditor(" first comment "));
    const savedComment = useReviewDraftStore.getState().drafts[firstKey]?.[0];
    expect(savedComment).toMatchObject({
      filePath: "src/example.ts",
      side: "new",
      lineNumber: 2,
      body: "first comment",
    });
    expect(result.current.editor).toBeNull();
    expect(result.current.commentsByTarget.get(reviewTarget.key)?.[0]).toMatchObject({
      body: "first comment",
    });

    act(() => result.current.onEditComment(reviewTarget, savedComment));
    expect(result.current.editor).toEqual({
      target: reviewTarget,
      commentId: savedComment?.id,
      body: "first comment",
      focusRequestId: 0,
    });

    act(() => result.current.onSaveEditor(" updated comment "));
    const updatedComment = useReviewDraftStore.getState().drafts[firstKey]?.[0];
    expect(updatedComment).toMatchObject({ id: savedComment?.id, body: "updated comment" });

    act(() => result.current.onEditComment(reviewTarget, updatedComment));
    act(() => result.current.onDeleteComment(updatedComment.id));
    expect(useReviewDraftStore.getState().drafts[firstKey]).toEqual([]);
    expect(result.current.editor).toBeNull();

    act(() => result.current.onStartComment(reviewTarget));
    act(() => result.current.onCancelEditor());
    expect(result.current.editor).toBeNull();

    act(() => result.current.onStartComment(reviewTarget));
    rerender({ reviewDraftKey: secondKey });
    expect(result.current.editor).toBeNull();
    expect(result.current.highlight).toBeUndefined();
  });

  it("comments on the highlighted range and stores its start line", () => {
    const start = target({ side: "old", lineNumber: 368, oldLineNumber: 368, newLineNumber: null });
    const end = target({ lineNumber: 386, newLineNumber: 386 });
    const { result } = renderHook(() =>
      useInlineReviewController({ reviewDraftKey: "review", buildContext: noContext }),
    );

    act(() => result.current.onHighlight({ start, end }));
    act(() => result.current.onStartHighlightComment());
    expect(result.current.editor).toMatchObject({ target: end, start, commentId: null });

    act(() => result.current.onSaveEditor("range note"));
    expect(useReviewDraftStore.getState().drafts.review?.[0]).toMatchObject({
      side: "new",
      lineNumber: 386,
      startSide: "old",
      startLineNumber: 368,
      body: "range note",
    });
    expect(result.current.editor).toBeNull();
    expect(result.current.highlight).toBeUndefined();

    const saved = useReviewDraftStore.getState().drafts.review![0]!;
    act(() => result.current.onEditComment(end, saved));
    expect(result.current.highlight?.start).toMatchObject({ side: "old", lineNumber: 368 });
    act(() => result.current.onSaveEditor("edited"));
    expect(useReviewDraftStore.getState().drafts.review?.[0]).toMatchObject({
      id: saved.id,
      startLineNumber: 368,
      body: "edited",
    });
  });

  it("stores the viewer's context for the range when a comment is created, not when edited", () => {
    const start = target({ lineNumber: 3, newLineNumber: 3 });
    const end = target({ lineNumber: 5, newLineNumber: 5 });
    const context = {
      hunkHeader: "",
      targetLine: { oldLineNumber: null, newLineNumber: 5, type: "context" as const, content: "" },
      lines: [],
    };
    const buildContext = vi.fn(() => context);
    const { result } = renderHook(() =>
      useInlineReviewController({ reviewDraftKey: "review", buildContext }),
    );

    act(() => result.current.onHighlight({ start, end }));
    act(() => result.current.onStartHighlightComment());
    act(() => result.current.onSaveEditor("range note"));
    expect(buildContext).toHaveBeenCalledWith({ start, end });
    const saved = useReviewDraftStore.getState().drafts.review![0]!;
    expect(saved.context).toEqual(context);

    act(() => result.current.onEditComment(end, saved));
    act(() => result.current.onSaveEditor("edited"));
    expect(buildContext).toHaveBeenCalledTimes(1);
  });

  it("focuses the open editor instead of reopening the same range", () => {
    const reviewTarget = target();
    const { result } = renderHook(() =>
      useInlineReviewController({ reviewDraftKey: "review", buildContext: noContext }),
    );

    act(() => result.current.onStartComment(reviewTarget));
    act(() => result.current.onEditorBodyChange("typed"));
    act(() => result.current.onStartHighlightComment());

    expect(result.current.editor?.focusRequestId).toBe(1);
    expect(useReviewDraftStore.getState().drafts.review ?? []).toEqual([]);
  });

  it("focuses a pencil edit when its range is the highlight instead of opening a new editor", () => {
    const start = target({ lineNumber: 3, newLineNumber: 3 });
    const end = target({ lineNumber: 5, newLineNumber: 5 });
    const { result } = renderHook(() =>
      useInlineReviewController({ reviewDraftKey: "review", buildContext: noContext }),
    );

    act(() => result.current.onHighlight({ start, end }));
    act(() => result.current.onStartHighlightComment());
    act(() => result.current.onSaveEditor("range note"));
    const saved = useReviewDraftStore.getState().drafts.review![0]!;
    act(() => result.current.onEditComment(end, saved));
    act(() => result.current.onEditorBodyChange("edited"));
    act(() => result.current.onStartHighlightComment());

    expect(result.current.editor).toMatchObject({ commentId: saved.id, focusRequestId: 1 });
    expect(useReviewDraftStore.getState().drafts.review).toEqual([saved]);
  });

  it("saves a non-empty open editor before opening another and discards an empty one", () => {
    const first = target({ lineNumber: 3, newLineNumber: 3 });
    const second = target({ lineNumber: 5, newLineNumber: 5 });
    const third = target({ lineNumber: 7, newLineNumber: 7 });
    const { result } = renderHook(() =>
      useInlineReviewController({ reviewDraftKey: "review", buildContext: noContext }),
    );

    act(() => result.current.onStartComment(first));
    act(() => result.current.onEditorBodyChange("  keep me  "));
    act(() => result.current.onStartComment(second));
    act(() => result.current.onEditorBodyChange("   "));
    act(() => result.current.onStartComment(third));

    expect(useReviewDraftStore.getState().drafts.review).toEqual([
      expect.objectContaining({ lineNumber: 3, body: "keep me", startSide: undefined }),
    ]);
    expect(result.current.editor?.target).toBe(third);
    expect(result.current.highlight).toEqual(singleLineRange(third));
  });

  it("toggles a single highlighted line and leaves another highlight when the editor closes", () => {
    const first = target({ lineNumber: 3, newLineNumber: 3 });
    const second = target({ lineNumber: 5, newLineNumber: 5 });
    const { result } = renderHook(() =>
      useInlineReviewController({ reviewDraftKey: "review", buildContext: noContext }),
    );

    act(() => result.current.onToggleHighlight(first));
    expect(result.current.highlight).toEqual(singleLineRange(first));
    act(() => result.current.onToggleHighlight(second));
    expect(result.current.highlight).toEqual(singleLineRange(second));
    act(() => result.current.onToggleHighlight(second));
    expect(result.current.highlight).toBeUndefined();

    act(() => result.current.onHighlight({ start: first, end: second }));
    act(() => result.current.onToggleHighlight(second));
    expect(result.current.highlight).toEqual(singleLineRange(second));

    act(() => result.current.onStartComment(first));
    act(() => result.current.onToggleHighlight(second));
    act(() => result.current.onCancelEditor());
    expect(result.current.highlight).toEqual(singleLineRange(second));
  });
});

describe("git diff inline review helpers", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    pressablePropsByLabel.clear();
  });

  it("maps persisted draft comments to their reviewable diff target", () => {
    const comments = [
      comment(),
      comment({ id: "comment-2", side: "old", lineNumber: 8 }),
      comment({ id: "comment-3", filePath: "src/other.ts" }),
    ];
    const commentsByTarget = groupInlineReviewCommentsByTarget(comments);

    expect(commentsByTarget.get("src/example.ts:new:2")).toEqual([comments[0]]);
    expect(commentsByTarget.get("src/example.ts:old:8")).toEqual([comments[1]]);
    expect(commentsByTarget.get("src/other.ts:new:2")).toEqual([comments[2]]);
    expect(
      getInlineReviewThreadState({
        reviewTarget: target(),
        reviewActions: buildReviewActions({ commentsByTarget }),
      })?.comments,
    ).toEqual([comments[0]]);
  });

  it("reserves split inline review height from the taller side", () => {
    const leftTarget = target({ side: "old", lineNumber: 8, oldLineNumber: 8 });
    const rightTarget = target();
    const rightComment = comment();
    const actions = buildReviewActions({
      commentsByTarget: groupInlineReviewCommentsByTarget([rightComment]),
      editor: { target: rightTarget, commentId: null, body: "", focusRequestId: 0 },
    });

    const rowState = getSplitInlineReviewThreadState({
      left: leftTarget,
      right: rightTarget,
      reviewActions: actions,
    });

    expect(rowState?.left).toBeNull();
    expect(rowState?.right?.comments).toEqual([rightComment]);
    expect(rowState?.height).toBe(155);
  });

  it("reserves the editor's laid-out height once it reports one", () => {
    const reviewTarget = target();
    const actions = buildReviewActions({
      editor: { target: reviewTarget, commentId: null, body: "", focusRequestId: 0, height: 300 },
    });

    expect(getInlineReviewThreadState({ reviewTarget, reviewActions: actions })?.height).toBe(308);
  });

  it("reserves a comment card's laid-out height once it reports one", () => {
    const reviewTarget = target();
    const saved = comment();
    const actions = buildReviewActions({
      commentsByTarget: groupInlineReviewCommentsByTarget([saved]),
      commentHeights: new Map([[saved.id, 120]]),
    });

    expect(getInlineReviewThreadState({ reviewTarget, reviewActions: actions })?.height).toBe(128);
  });

  it("includes thread padding in the inline editor height", () => {
    const reviewTarget = target();
    const actions = buildReviewActions({
      editor: { target: reviewTarget, commentId: null, body: "", focusRequestId: 0 },
    });

    expect(getInlineReviewThreadState({ reviewTarget, reviewActions: actions })?.height).toBe(113);
  });

  it("pins no-wrap review threads to the visible diff viewport", () => {
    expect(
      getInlineReviewThreadViewportStyle({
        viewportWidth: 320,
        pinToViewport: true,
      }),
    ).toEqual([{ position: "sticky", left: 0 }, inlineUnistylesStyle({ width: 320 })]);
  });

  it("keeps the gutter add-comment target accessible and clicking opens the editor", () => {
    const onStartComment = vi.fn();
    const reviewTarget = target();
    const { getByLabelText } = render(
      <InlineReviewGutterCell
        reviewTarget={reviewTarget}
        comments={EMPTY_COMMENTS}
        isEditorOpen={false}
        onStartComment={onStartComment}
      >
        <span>2</span>
      </InlineReviewGutterCell>,
    );

    fireEvent.click(getByLabelText("Add review comment"));
    expect(onStartComment).toHaveBeenCalledWith(reviewTarget);
    expect(pressablePropsByLabel.get("Add review comment")?.hitSlop).toBe(SMALL_ACTION_HIT_SLOP);
  });

  it("keeps the line number visible and only floats the plus for line hover", () => {
    const reviewTarget = target();
    const { container, queryByText, rerender } = render(
      <InlineReviewGutterCell
        reviewTarget={reviewTarget}
        comments={EMPTY_COMMENTS}
        isEditorOpen={false}
        onStartComment={vi.fn()}
      >
        <span>2</span>
      </InlineReviewGutterCell>,
    );

    expect(queryByText("2")).toBeTruthy();
    expect(container.querySelector("[data-icon='Plus']")).toBeNull();

    rerender(
      <InlineReviewGutterCell
        reviewTarget={reviewTarget}
        comments={COMMENT_LIST}
        isEditorOpen={false}
        onStartComment={vi.fn()}
      >
        <span>2</span>
      </InlineReviewGutterCell>,
    );

    expect(queryByText("2")).toBeTruthy();
    expect(container.querySelector("[data-icon='Plus']")).toBeNull();

    rerender(
      <InlineReviewGutterCell
        reviewTarget={reviewTarget}
        comments={EMPTY_COMMENTS}
        isEditorOpen
        onStartComment={vi.fn()}
      >
        <span>2</span>
      </InlineReviewGutterCell>,
    );

    expect(queryByText("2")).toBeTruthy();
    expect(container.querySelector("[data-icon='Plus']")).toBeNull();

    rerender(
      <InlineReviewGutterCell
        reviewTarget={reviewTarget}
        comments={COMMENT_LIST}
        isEditorOpen={false}
        isLineHovered
        onStartComment={vi.fn()}
      >
        <span>2</span>
      </InlineReviewGutterCell>,
    );

    expect(queryByText("2")).toBeTruthy();
    expect(container.querySelector("[data-icon='Plus']")).toBeTruthy();
  });
});

describe("InlineReviewEditor", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    cleanup();
    vi.clearAllMocks();
  });

  it("saves trimmed bodies and cancels without saving", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    const { getByTestId } = render(
      <InlineReviewEditor
        range={singleLineRange(target())}
        initialBody=" initial "
        focusRequestId={0}
        onChangeBody={vi.fn()}
        onHeightChange={vi.fn()}
        onCancel={onCancel}
        onSave={onSave}
        testID="editor"
      />,
    );

    fireEvent.change(getByTestId("editor-input"), { target: { value: " updated comment " } });
    fireEvent.click(getByTestId("editor-save"));
    expect(onSave).toHaveBeenCalledWith("updated comment");

    fireEvent.click(getByTestId("editor-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("handles Escape cancel and Mod+Enter save from the focused textarea", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    const { getByTestId } = render(
      <InlineReviewEditor
        range={singleLineRange(target())}
        initialBody="ready"
        focusRequestId={0}
        onChangeBody={vi.fn()}
        onHeightChange={vi.fn()}
        onCancel={onCancel}
        onSave={onSave}
        testID="editor"
      />,
    );
    const input = getByTestId("editor-input");

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onSave).toHaveBeenCalledWith("ready");
  });

  it("keeps macOS Home/End/Page scroll keys inside the textarea", () => {
    const { getByTestId } = render(
      <InlineReviewEditor
        range={singleLineRange(target())}
        initialBody="ready"
        focusRequestId={0}
        onChangeBody={vi.fn()}
        onHeightChange={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        testID="editor"
      />,
    );
    const input = getByTestId("editor-input");

    shortcutOs.current = "mac";
    for (const key of ["Home", "End", "PageUp", "PageDown"]) {
      expect(fireEvent.keyDown(input, { key })).toBe(false);
    }
    expect(fireEvent.keyDown(input, { key: "End", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "ArrowDown" })).toBe(true);

    shortcutOs.current = "non-mac";
    expect(fireEvent.keyDown(input, { key: "End" })).toBe(true);
  });

  it("does not show shortcut hints in the action buttons", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const { getByTestId, queryByText } = render(
      <InlineReviewEditor
        range={singleLineRange(target())}
        initialBody="ready"
        focusRequestId={0}
        onChangeBody={vi.fn()}
        onHeightChange={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        testID="editor"
      />,
    );
    const input = getByTestId("editor-input");

    fireEvent.focus(input);
    expect(queryByText("Esc")).toBeNull();
    expect(queryByText(/(?:⌘⏎|Ctrl\+⏎)/)).toBeNull();
  });
});

describe("InlineReviewThread", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("exposes edit and delete actions for existing comments", () => {
    const reviewTarget = target();
    const draftComment = comment();
    const actions = buildReviewActions({
      commentsByTarget: groupInlineReviewCommentsByTarget([draftComment]),
    });

    const { getByTestId, getByText } = render(
      <InlineReviewThread
        reviewTarget={reviewTarget}
        reviewActions={actions}
        height={76}
        testID="thread"
      />,
    );

    expect(getByText("Please simplify this.")).toBeTruthy();
    fireEvent.click(getByTestId("review-comment-edit-comment-1"));
    expect(actions.onEditComment).toHaveBeenCalledWith(reviewTarget, draftComment);
    fireEvent.click(getByTestId("review-comment-delete-comment-1"));
    expect(actions.onDeleteComment).toHaveBeenCalledWith("comment-1");
  });

  it("keeps multiline comment text and starts each card at the one-line reservation", () => {
    const reviewTarget = target();
    const actions = buildReviewActions({
      commentsByTarget: groupInlineReviewCommentsByTarget([comment({ body: "line 1\nline 2" })]),
    });
    const { getByText } = render(
      <InlineReviewThread reviewTarget={reviewTarget} reviewActions={actions} height={44} />,
    );

    const body = getByText(/line 1/);
    expect(body.textContent).toBe("line 1\nline 2");
    expect(getComputedStyle(body).whiteSpace).not.toBe("nowrap");
    expect(getComputedStyle(body.parentElement!).minHeight).toBe(
      `${INLINE_REVIEW_COMMENT_HEIGHT}px`,
    );
  });

  it("labels single-line and range comments and the editor by side and line", () => {
    const reviewTarget = target({ lineNumber: 386, newLineNumber: 386 });
    const single = comment({ lineNumber: 386 });
    const range = comment({
      id: "comment-2",
      lineNumber: 386,
      startSide: "old",
      startLineNumber: 368,
    });
    const actions = buildReviewActions({
      commentsByTarget: groupInlineReviewCommentsByTarget([single, range]),
      editor: {
        target: reviewTarget,
        start: { filePath: "src/example.ts", side: "new", lineNumber: 380 },
        commentId: null,
        body: "",
        focusRequestId: 0,
      },
    });

    const { getByText } = render(
      <InlineReviewThread reviewTarget={reviewTarget} reviewActions={actions} height={300} />,
    );

    expect(getByText("Line R386")).toBeTruthy();
    expect(getByText("Lines L368–R386")).toBeTruthy();
    expect(getByText("Lines R380–R386")).toBeTruthy();
  });
});
