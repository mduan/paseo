import { z } from "zod";
import {
  ReviewAttachmentCommentSchema,
  ReviewCommentSourceSchema,
} from "@getpaseo/protocol/messages";

export type ReviewDraftMode = "uncommitted" | "base";
export type ReviewDraftSide = "old" | "new";

const ReviewDraftCommentContextSchema = ReviewAttachmentCommentSchema.shape.context;
export type ReviewDraftCommentContext = z.infer<typeof ReviewDraftCommentContextSchema>;

export interface ReviewDraftComment {
  id: string;
  filePath: string;
  side: ReviewDraftSide;
  lineNumber: number;
  // Top end of a range comment; `side`/`lineNumber` are the bottom end, where the thread anchors.
  startSide?: ReviewDraftSide;
  startLineNumber?: number;
  /** The anchor line's text, so the comment still has context once that line is out of the diff. */
  content?: string;
  /** Lines around the range, captured by the viewer the comment was made in. */
  context?: ReviewDraftCommentContext;
  /** Absent for diff comments; "file" when made in the file viewer. */
  source?: z.infer<typeof ReviewCommentSourceSchema>;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewDraftStoreState {
  drafts: Record<string, ReviewDraftComment[]>;
}

export interface SerializedReviewDraftState {
  drafts: Record<string, ReviewDraftComment[]>;
  activeModesByScope?: Record<string, ReviewDraftMode>;
}

const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const ReviewDraftCommentSchema: z.ZodType<ReviewDraftComment> = z.strictObject({
  id: z.string(),
  filePath: z.string(),
  side: z.enum(["old", "new"]),
  lineNumber: z.number().int().positive(),
  startSide: z.enum(["old", "new"]).optional(),
  startLineNumber: z.number().int().positive().optional(),
  content: z.string().optional(),
  context: ReviewDraftCommentContextSchema.optional(),
  source: ReviewCommentSourceSchema.optional(),
  body: z.string(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const SerializedReviewDraftStateSchema: z.ZodType<SerializedReviewDraftState> =
  z.strictObject({
    drafts: z.record(z.string(), z.array(ReviewDraftCommentSchema)),
    // COMPAT(reviewDraftModes): v1 persisted this field; v2 discards it during migration.
    activeModesByScope: z.record(z.string(), z.enum(["uncommitted", "base"])).optional(),
  });

export function addCommentToState(
  state: ReviewDraftStoreState,
  input: { key: string; comment: ReviewDraftComment },
): ReviewDraftStoreState {
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [input.key]: [...(state.drafts[input.key] ?? []), input.comment],
    },
  };
}

export function updateCommentInState(
  state: ReviewDraftStoreState,
  input: {
    key: string;
    id: string;
    updates: Partial<Pick<ReviewDraftComment, "body">>;
    updatedAt: string;
  },
): ReviewDraftStoreState {
  const comments = state.drafts[input.key] ?? [];
  if (!comments.some((comment) => comment.id === input.id)) {
    return state;
  }
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [input.key]: comments.map((comment) =>
        applyCommentUpdates(comment, input.id, input.updates, input.updatedAt),
      ),
    },
  };
}

export function deleteCommentFromState(
  state: ReviewDraftStoreState,
  input: { key: string; id: string },
): ReviewDraftStoreState {
  const comments = state.drafts[input.key] ?? [];
  if (!comments.some((comment) => comment.id === input.id)) {
    return state;
  }
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [input.key]: comments.filter((comment) => comment.id !== input.id),
    },
  };
}

export function clearReviewInState(
  state: ReviewDraftStoreState,
  input: { key: string },
): ReviewDraftStoreState {
  if (!state.drafts[input.key]) {
    return state;
  }
  const nextDrafts = { ...state.drafts };
  delete nextDrafts[input.key];
  return { ...state, drafts: nextDrafts };
}

export function serializeReviewDraftState(
  state: ReviewDraftStoreState,
): SerializedReviewDraftState {
  return {
    drafts: state.drafts,
  };
}

export function normalizePersistedState(state: unknown): ReviewDraftStoreState {
  const result = SerializedReviewDraftStateSchema.safeParse(state);
  return {
    drafts: result.success ? mergeDraftsByWorkspace(result.data.drafts) : {},
  };
}

// COMPAT(reviewDraftWorkspaceKey): added in v0.11, remove after 2027-04-03.
// Keys before v3 also held the diff mode, base ref, and whitespace setting.
const LEGACY_KEY_PART = /^(mode|base|ignoreWhitespace)=/;

function mergeDraftsByWorkspace(
  drafts: Record<string, ReviewDraftComment[]>,
): Record<string, ReviewDraftComment[]> {
  const merged: Record<string, ReviewDraftComment[]> = {};
  for (const [key, comments] of Object.entries(drafts)) {
    const workspaceKey = key
      .split(":")
      .filter((part) => !LEGACY_KEY_PART.test(part))
      .join(":");
    const existing = merged[workspaceKey] ?? [];
    const ids = new Set(existing.map((comment) => comment.id));
    merged[workspaceKey] = [...existing, ...comments.filter((comment) => !ids.has(comment.id))];
  }
  return merged;
}

function applyCommentUpdates(
  comment: ReviewDraftComment,
  targetId: string,
  updates: Partial<Pick<ReviewDraftComment, "body">>,
  updatedAt: string,
): ReviewDraftComment {
  if (comment.id !== targetId) {
    return comment;
  }
  return {
    ...comment,
    body: updates.body ?? comment.body,
    updatedAt,
  };
}
