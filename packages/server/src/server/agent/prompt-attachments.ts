import { getForgeDefinitionOrNeutral } from "@getpaseo/protocol/forge-manifest";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { AgentPromptContentBlock, AgentPromptInput } from "./agent-sdk-types.js";

const REVIEW_LINE_MARKERS = { add: "+", remove: "-", context: " " } as const;

export function buildAgentPrompt(
  text: string,
  images?: Array<{ data: string; mimeType: string }>,
  attachments?: AgentAttachment[],
): AgentPromptInput {
  const normalized = text.trim();
  const hasImages = (images?.length ?? 0) > 0;
  const hasAttachments = (attachments?.length ?? 0) > 0;
  if (!hasImages && !hasAttachments) {
    return normalized;
  }

  const chatHistoryAttachments: AgentAttachment[] = [];
  const otherAttachments: AgentAttachment[] = [];
  for (const attachment of attachments ?? []) {
    if (attachment.type === "text" && attachment.contextKind === "chat_history") {
      chatHistoryAttachments.push(attachment);
    } else {
      otherAttachments.push(attachment);
    }
  }

  const blocks: AgentPromptContentBlock[] = [...chatHistoryAttachments];
  if (normalized.length > 0) {
    blocks.push({ type: "text", text: normalized });
  }
  for (const image of images ?? []) {
    blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  blocks.push(...otherAttachments);
  return blocks;
}

export function renderPromptAttachmentAsText(attachment: AgentAttachment): string {
  switch (attachment.type) {
    case "forge_change_request": {
      return renderChangeRequestAttachment({
        forge: attachment.forge,
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        body: attachment.body,
        projectPath: attachment.projectPath,
        baseRefName: attachment.baseRefName,
        headRefName: attachment.headRefName,
      });
    }
    // COMPAT(githubAttachmentKinds): render legacy wire attachments until
    // 2027-01-17, when supported client and daemon floors are >= v0.2.0.
    case "github_pr": {
      return renderChangeRequestAttachment({
        forge: "github",
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        body: attachment.body,
        baseRefName: attachment.baseRefName,
        headRefName: attachment.headRefName,
      });
    }
    case "forge_issue": {
      return renderIssueAttachment({
        forge: attachment.forge,
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        body: attachment.body,
        projectPath: attachment.projectPath,
      });
    }
    // COMPAT(githubAttachmentKinds): render legacy wire attachments until
    // 2027-01-17, when supported client and daemon floors are >= v0.2.0.
    case "github_issue": {
      return renderIssueAttachment({
        forge: "github",
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        body: attachment.body,
      });
    }
    case "text": {
      return attachment.text;
    }
    case "review": {
      const lines = [`Paseo review attachment (${attachment.mode})`, `CWD: ${attachment.cwd}`];
      if (attachment.baseRef) {
        lines.push(`Base: ${attachment.baseRef}`);
      }
      attachment.comments.forEach((comment, index) => {
        const end: ReviewLineRef = { side: comment.side, lineNumber: comment.lineNumber };
        const start: ReviewLineRef =
          comment.startLineNumber === undefined
            ? end
            : { side: comment.startSide ?? comment.side, lineNumber: comment.startLineNumber };
        const isSingleLine = start.side === end.side && start.lineNumber === end.lineNumber;
        const location = isSingleLine
          ? formatReviewLine(end)
          : `${formatReviewLine(start)}-${formatReviewLine(end)}`;
        lines.push("", `Comment ${index + 1}: ${comment.filePath}:${location}`, comment.body);
        // File viewer comments have no hunk.
        if (comment.context.hunkHeader) {
          lines.push(comment.context.hunkHeader);
        }
        const contextLines = comment.context.lines;
        const startIndex = contextLines.findIndex((line) => isReviewLine(line, start));
        const endIndex = contextLines.findIndex((line) => isReviewLine(line, end));
        // The client caps context, so a long range can end past the last context line.
        const lastMarkedIndex = endIndex === -1 ? contextLines.length - 1 : endIndex;
        contextLines.forEach((line, lineIndex) => {
          const isMarked =
            startIndex !== -1 && lineIndex >= startIndex && lineIndex <= lastMarkedIndex;
          const prefix = isMarked ? "> " : "  ";
          const oldLn = padLineNumber(line.oldLineNumber);
          const newLn = padLineNumber(line.newLineNumber);
          lines.push(`${prefix}${oldLn} ${newLn} ${REVIEW_LINE_MARKERS[line.type]}${line.content}`);
        });
        if (startIndex !== -1 && endIndex === -1) {
          lines.push(`  (Range truncated. Read ${comment.filePath} for the rest.)`);
        }
      });
      return lines.join("\n");
    }
    case "uploaded_file": {
      return [
        `Uploaded file: ${attachment.fileName}`,
        `Path: ${attachment.path}`,
        `MIME: ${attachment.mimeType}`,
        `Size: ${attachment.size} bytes`,
      ].join("\n");
    }
    default:
      throw new Error("unreachable");
  }
}

function renderChangeRequestAttachment(input: {
  forge: string;
  number: number;
  title: string;
  url: string;
  body?: string | null;
  projectPath?: string;
  baseRefName?: string | null;
  headRefName?: string | null;
}): string {
  const lines = [
    `${formatForgeLabel(input.forge)} ${formatChangeRequestAbbrev(input.forge)} ${formatChangeRequestNumber(input.forge, input.number)}: ${input.title}`,
    input.url,
  ];
  if (input.projectPath) {
    lines.push(`Project: ${input.projectPath}`);
  }
  if (input.baseRefName) {
    lines.push(`Base: ${input.baseRefName}`);
  }
  if (input.headRefName) {
    lines.push(`Head: ${input.headRefName}`);
  }
  if (input.body) {
    lines.push("", input.body);
  }
  return lines.join("\n");
}

function renderIssueAttachment(input: {
  forge: string;
  number: number;
  title: string;
  url: string;
  body?: string | null;
  projectPath?: string;
}): string {
  const lines = [
    `${formatForgeLabel(input.forge)} Issue ${formatIssueNumber(input.forge, input.number)}: ${input.title}`,
    input.url,
  ];
  if (input.projectPath) {
    lines.push(`Project: ${input.projectPath}`);
  }
  if (input.body) {
    lines.push("", input.body);
  }
  return lines.join("\n");
}

function formatForgeLabel(forge: string): string {
  return getForgeDefinitionOrNeutral(forge).displayName;
}

function formatChangeRequestAbbrev(forge: string): string {
  return getForgeDefinitionOrNeutral(forge).changeRequestAbbrev;
}

function formatChangeRequestNumber(forge: string, number: number): string {
  return `${getForgeDefinitionOrNeutral(forge).changeRequestNumberPrefix}${number}`;
}

function formatIssueNumber(forge: string, number: number): string {
  return `${getForgeDefinitionOrNeutral(forge).issueNumberPrefix}${number}`;
}

type ReviewComment = Extract<AgentAttachment, { type: "review" }>["comments"][number];
type ReviewLineRef = Pick<ReviewComment, "side" | "lineNumber">;

function formatReviewLine(ref: ReviewLineRef): string {
  return `${ref.side === "old" ? "L" : "R"}${ref.lineNumber}`;
}

function isReviewLine(
  line: ReviewComment["context"]["lines"][number],
  ref: ReviewLineRef,
): boolean {
  return (ref.side === "old" ? line.oldLineNumber : line.newLineNumber) === ref.lineNumber;
}

function padLineNumber(lineNumber: number | null): string {
  return (lineNumber?.toString() ?? "-").padStart(2);
}

export function buildAgentBranchNameSeed(
  firstAgentContext: { prompt?: string; attachments?: readonly AgentAttachment[] } | undefined,
): string | undefined {
  if (!firstAgentContext) {
    return undefined;
  }
  const parts: string[] = [];
  const prompt = firstAgentContext.prompt?.trim();
  if (prompt) {
    parts.push(["<user-prompt>", prompt, "</user-prompt>"].join("\n"));
  }
  const renderedAttachments: string[] = [];
  for (const attachment of firstAgentContext.attachments ?? []) {
    const rendered = renderPromptAttachmentAsText(attachment).trim();
    if (rendered) {
      renderedAttachments.push(rendered);
    }
  }
  if (renderedAttachments.length > 0) {
    parts.push(["<attachments>", renderedAttachments.join("\n\n"), "</attachments>"].join("\n"));
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
