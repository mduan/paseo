import type { ReviewableDiffTarget, ReviewableDiffTargetKeyInput } from "@/utils/diff-layout";
import { buildReviewableDiffTargetKey } from "@/utils/diff-layout";
import type { ReviewLineRange } from "./range";
import type { ReviewDraftComment } from "./store";

// One body line (15px font, 1.4 line height), the card's border, and 6px above and below.
export const INLINE_REVIEW_COMMENT_HEIGHT = 36;
/** The editor's height with a one-line input, reserved until it reports its laid-out height. */
export const INLINE_REVIEW_EDITOR_HEIGHT = 105;
export const INLINE_REVIEW_GAP = 6;
export const INLINE_REVIEW_VERTICAL_PADDING = 4;

export interface InlineReviewEditorState {
  target: ReviewableDiffTarget;
  /** Top end of a range comment; absent for a single line. */
  start?: ReviewableDiffTargetKeyInput;
  commentId: string | null;
  body: string;
  /** Bumped to move focus back into the open editor. */
  focusRequestId: number;
  /** The editor's laid-out height; it grows with its text. */
  height?: number;
}

export interface InlineReviewActions {
  commentsByTarget: ReadonlyMap<string, ReviewDraftComment[]>;
  editor: InlineReviewEditorState | null;
  /** Highlighted diff lines; the open editor's range or a gutter selection. */
  highlight?: ReviewLineRange;
  onHighlight: (range: ReviewLineRange) => void;
  onToggleHighlight: (target: ReviewableDiffTarget) => void;
  onStartComment: (target: ReviewableDiffTarget) => void;
  /** Opens the editor for the highlighted range, or focuses it when it is already open. */
  onStartHighlightComment: () => void;
  onEditComment: (target: ReviewableDiffTarget, comment: ReviewDraftComment) => void;
  onEditorBodyChange: (body: string) => void;
  onEditorHeightChange: (height: number) => void;
  onCancelEditor: () => void;
  onSaveEditor: (body: string) => void;
  onDeleteComment: (id: string) => void;
}

/** The review state that shapes diff layout; the highlight and callbacks only repaint. */
export type InlineReviewGeometry = Pick<InlineReviewActions, "commentsByTarget" | "editor">;

export function editorLineRange(editor: InlineReviewEditorState): ReviewLineRange {
  return { start: editor.start ?? editor.target, end: editor.target };
}

export function isInlineReviewEditorForTarget(
  editor: InlineReviewEditorState | null,
  target: ReviewableDiffTarget | null | undefined,
): boolean {
  return Boolean(
    editor &&
    target &&
    buildReviewableDiffTargetKey(editor.target) === buildReviewableDiffTargetKey(target),
  );
}

export function getInlineReviewThreadState(input: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewGeometry;
}): {
  comments: ReviewDraftComment[];
  hasEditor: boolean;
  editingCommentId: string | null;
  height: number;
} | null {
  const { reviewTarget, reviewActions } = input;
  if (!reviewTarget || !reviewActions) return null;

  const comments = reviewActions.commentsByTarget.get(reviewTarget.key) ?? [];
  const editorForTarget = isInlineReviewEditorForTarget(reviewActions.editor, reviewTarget)
    ? reviewActions.editor
    : null;
  const hasEditor = editorForTarget !== null;
  const editingCommentId = editorForTarget?.commentId ?? null;
  const editingExisting =
    editingCommentId !== null && comments.some((comment) => comment.id === editingCommentId);
  const visibleCommentCount = editingExisting ? comments.length - 1 : comments.length;
  const editorCount = hasEditor ? 1 : 0;
  const visibleBlockCount = visibleCommentCount + editorCount;
  if (visibleBlockCount === 0) return null;

  const height =
    visibleCommentCount * INLINE_REVIEW_COMMENT_HEIGHT +
    editorCount * (editorForTarget?.height ?? INLINE_REVIEW_EDITOR_HEIGHT) +
    Math.max(0, visibleBlockCount - 1) * INLINE_REVIEW_GAP +
    INLINE_REVIEW_VERTICAL_PADDING * 2;
  return { comments, hasEditor, editingCommentId, height };
}

export function getSplitInlineReviewThreadState(input: {
  left: ReviewableDiffTarget | null | undefined;
  right: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewGeometry;
}): {
  left: ReturnType<typeof getInlineReviewThreadState>;
  right: ReturnType<typeof getInlineReviewThreadState>;
  height: number;
} | null {
  const left = getInlineReviewThreadState({
    reviewTarget: input.left,
    reviewActions: input.reviewActions,
  });
  const right = getInlineReviewThreadState({
    reviewTarget: input.right,
    reviewActions: input.reviewActions,
  });
  const height = Math.max(left?.height ?? 0, right?.height ?? 0);
  return height === 0 ? null : { left, right, height };
}
