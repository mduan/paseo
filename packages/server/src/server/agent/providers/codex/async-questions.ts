import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AgentAttachmentSchema } from "@getpaseo/protocol/messages";
import { QuestionAnswerContextSchema } from "@getpaseo/protocol/prompt-attachments";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  ToolCallTimelineItem,
  AgentTimelineItem,
  AgentRunOptions,
} from "../../agent-sdk-types.js";

const QuestionSchema = z.object({
  title: z.string().trim().min(1),
  options: z.array(z.string().min(1)).nullish(),
});
const ItemSchema = z.object({
  type: z.literal("agentMessage"),
  id: z.string().min(1),
  delivery: z.literal("async"),
  questions: z.array(QuestionSchema).min(1),
});
const RecordSchema = z.object({
  item: ItemSchema,
  resolution: z.union([z.literal("dismissed"), z.array(z.string())]).optional(),
  answerMessage: z
    .object({
      clientMessageId: z.string(),
      messageId: z.string().optional(),
      text: z.string(),
      imageSources: z.array(z.string()),
      attachments: z.array(AgentAttachmentSchema),
    })
    .optional(),
});
type QuestionRecord = z.infer<typeof RecordSchema>;

function requestId(itemId: string): string {
  return `permission-${itemId}`;
}

function toPermission(record: QuestionRecord): AgentPermissionRequest {
  return {
    id: requestId(record.item.id),
    provider: "codex",
    name: "request_user_input_async",
    kind: "question",
    title: "Question",
    input: {
      questions: record.item.questions.map((question, index) => ({
        id: String(index),
        header: `Question ${index + 1}`,
        question: question.title,
        options: (question.options ?? []).map((label) => ({ label })),
        isOther: true,
      })),
    },
  };
}

function toTimeline(record: QuestionRecord): ToolCallTimelineItem {
  const answers = Array.isArray(record.resolution) ? record.resolution : undefined;
  return {
    type: "tool_call",
    callId: record.item.id,
    name: "request_user_input_async",
    status: "completed",
    error: null,
    detail: {
      type: "plain_text",
      icon: "brain",
      text:
        record.item.questions
          .map((question, index) =>
            [question.title, answers ? answers[index] : (question.options ?? []).join(", ")]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n") + (record.resolution === "dismissed" ? "\n\nDismissed" : ""),
    },
  };
}

export function codexAsyncQuestionToTimeline(item: unknown): ToolCallTimelineItem | null {
  const parsed = ItemSchema.safeParse(item);
  return parsed.success ? toTimeline({ item: parsed.data }) : null;
}

/** Codex emits these as completed messages; the outstanding answer belongs to the session. */
export class CodexAsyncQuestions {
  private readonly records = new Map<string, QuestionRecord>();

  constructor(saved: unknown) {
    const parsed = z.array(RecordSchema).safeParse(saved);
    if (parsed.success) {
      for (const record of parsed.data) this.records.set(requestId(record.item.id), record);
    }
  }

  receive(item: unknown): AgentPermissionRequest | null {
    const parsed = ItemSchema.safeParse(item);
    if (!parsed.success || this.records.has(requestId(parsed.data.id))) return null;
    const record = { item: parsed.data };
    this.records.set(requestId(parsed.data.id), record);
    return toPermission(record);
  }

  pending(): AgentPermissionRequest[] {
    return Array.from(this.records.values())
      .filter((record) => record.resolution === undefined)
      .map(toPermission);
  }

  hasPending(id: string): boolean {
    const record = this.records.get(id);
    return record !== undefined && record.resolution === undefined;
  }

  prepareResponse(
    id: string,
    response: AgentPermissionResponse,
  ): {
    prompt?: string;
    clientMessageId?: string;
    presentation?: AgentRunOptions["promptPresentation"];
    complete: () => ToolCallTimelineItem;
  } {
    const record = this.records.get(id);
    if (!record || record.resolution !== undefined)
      throw new Error("Question is no longer pending");
    let resolution: QuestionRecord["resolution"] = "dismissed";
    let prompt: string | undefined;
    let clientMessageId: string | undefined;
    if (response.behavior === "allow") {
      const answers = z.record(z.string(), z.string()).parse(response.updatedInput?.answers);
      resolution = record.item.questions.map((_, index) => {
        const answer = answers[`Question ${index + 1}`]?.trim();
        if (!answer) throw new Error(`Answer Question ${index + 1} before submitting`);
        return answer;
      });
      const values = resolution;
      prompt =
        "Answers to your questions:\n\n" +
        record.item.questions
          .map((question, index) => `${question.title}\n${values[index]}`)
          .join("\n\n");
      const contexts = z
        .record(z.string(), QuestionAnswerContextSchema)
        .optional()
        .parse(response.updatedInput?.answerContexts);
      if (contexts && Object.keys(contexts).length) {
        const attached = record.item.questions.flatMap((_, index) => {
          const context = contexts[`Question ${index + 1}`];
          return context ? [context] : [];
        });
        clientMessageId = randomUUID();
        record.answerMessage = {
          clientMessageId,
          text:
            "Answers to your questions:\n\n" +
            record.item.questions
              .map(
                (question, index) =>
                  `${question.title}\n${contexts[`Question ${index + 1}`]?.text ?? values[index]}`,
              )
              .join("\n\n"),
          imageSources: attached.flatMap((context) => context.images.map((image) => image.path)),
          attachments: attached.flatMap((context) => context.attachments),
        };
      }
    }
    return {
      prompt,
      ...(clientMessageId ? { clientMessageId, presentation: record.answerMessage } : {}),
      complete: () => {
        record.resolution = resolution;
        return toTimeline(record);
      },
    };
  }

  decorateUserMessage(
    item: Extract<AgentTimelineItem, { type: "user_message" }>,
  ): Extract<AgentTimelineItem, { type: "user_message" }> {
    for (const record of this.records.values()) {
      const message = record.answerMessage;
      if (
        !message ||
        !(
          (item.clientMessageId && item.clientMessageId === message.clientMessageId) ||
          (item.messageId && item.messageId === message.messageId)
        )
      )
        continue;
      if (item.messageId) message.messageId = item.messageId;
      return {
        ...item,
        text: message.text,
        imageSources: message.imageSources,
        attachments: message.attachments,
      };
    }
    return item;
  }

  timeline(itemId: string): ToolCallTimelineItem | null {
    const record = this.records.get(requestId(itemId));
    return record ? toTimeline(record) : null;
  }

  retain(itemIds: ReadonlySet<string>): string[] {
    const removedPendingIds: string[] = [];
    for (const [id, record] of this.records) {
      if (itemIds.has(record.item.id)) continue;
      this.records.delete(id);
      if (record.resolution === undefined) removedPendingIds.push(id);
    }
    return removedPendingIds;
  }

  serialize(): unknown {
    return Array.from(this.records.values());
  }
}
