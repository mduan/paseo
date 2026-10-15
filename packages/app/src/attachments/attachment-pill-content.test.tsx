import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { ComposerAttachment } from "@/attachments/types";
import {
  getAgentAttachmentPillContent,
  getComposerAttachmentPillContent,
} from "./attachment-pill-content";

type ComposerPillCase = Readonly<{
  attachment: Exclude<ComposerAttachment, { kind: "image" }>;
  title: string;
  subtitle: string;
}>;

const composerPillCases: ComposerPillCase[] = [
  {
    attachment: {
      kind: "browser_element",
      attachment: {
        url: "https://example.com",
        selector: "button",
        tag: "button",
        text: "Filter",
        outerHTML: "<button>Filter</button>",
        computedStyles: {},
        boundingRect: { x: 0, y: 0, width: 32, height: 32 },
        reactSource: null,
        parentChain: [],
        children: [],
        formatted: "Filter button",
      },
    },
    title: "button",
    subtitle: "Element",
  },
  {
    attachment: {
      kind: "file",
      attachment: {
        type: "uploaded_file",
        id: "spec",
        fileName: "spec.pdf",
        mimeType: "application/pdf",
        size: 248,
        path: "/tmp/spec.pdf",
      },
    },
    title: "spec.pdf",
    subtitle: "PDF",
  },
  {
    attachment: {
      kind: "workspace_file",
      path: "src/filters.tsx",
      selection: { kind: "line_range", startLine: 42, endLine: 86 },
    },
    title: "filters.tsx",
    subtitle: "src/filters.tsx · 42-86",
  },
  {
    attachment: {
      kind: "plugin_resource",
      pluginId: "linear",
      sourceId: "issues",
      sourceTitle: "Linear issue",
      sourceIcon: "CircleDot",
      item: {
        id: "123",
        identifier: "ENG-123",
        title: "History filters",
        url: "https://linear.app/acme/issue/ENG-123",
        text: "Issue context",
        resourceType: "issue",
      },
    },
    title: "History filters",
    subtitle: "Linear issue ENG-123",
  },
  {
    attachment: {
      kind: "review",
      reviewDraftKey: "review",
      commentCount: 0,
      attachment: {
        type: "review",
        mimeType: "application/paseo-review",
        cwd: "/repo",
        mode: "uncommitted",
        comments: [],
      },
    },
    title: "Review",
    subtitle: "0 comments",
  },
  {
    attachment: {
      kind: "chat_history",
      id: "history",
      attachment: {
        type: "text",
        mimeType: "text/plain",
        contextKind: "chat_history",
        title: "History investigation",
        text: "Previous context",
      },
      source: { serverId: "host", agentId: "agent" },
    },
    title: "History investigation",
    subtitle: "Previous conversation",
  },
];

describe("composer attachment pill content", () => {
  it.each(composerPillCases)(
    "preserves the label for $attachment.kind",
    ({ attachment, title, subtitle }) => {
      const content = getComposerAttachmentPillContent(attachment, i18n.t);
      expect({ title: content.title, subtitle: content.subtitle }).toEqual({ title, subtitle });
    },
  );

  it.each([
    "forge.change_request_comment",
    "forge.change_request_review",
    "forge.change_request_check",
    "github.pull_request_comment",
    "github.pull_request_review",
    "github.pull_request_check",
  ] as const)("shows %s context", (kind) => {
    const content = getComposerAttachmentPillContent(
      { kind, id: kind, title: "Review context", text: "Context" },
      i18n.t,
    );
    expect(content.title).toBe("Review context");
  });

  it.each([
    { kind: "forge_issue", itemKind: "issue", subtitle: "Issue #42" },
    { kind: "forge_change_request", itemKind: "change_request", subtitle: "MR !42" },
    { kind: "github_issue", itemKind: "issue", subtitle: "Issue #42" },
    { kind: "github_pr", itemKind: "change_request", subtitle: "MR !42" },
  ] as const)("keeps forge labels for $kind", ({ kind, itemKind, subtitle }) => {
    const content = getComposerAttachmentPillContent(
      {
        kind,
        item: {
          kind: itemKind,
          forge: "gitlab",
          number: 42,
          title: "History fix",
          url: "https://gitlab.com/acme/paseo/-/merge_requests/42",
          state: "open",
          body: "Fix history",
          labels: [],
          baseRefName: "main",
          headRefName: "fix",
        },
      },
      i18n.t,
    );
    expect({ title: content.title, subtitle: content.subtitle }).toEqual({
      title: "History fix",
      subtitle,
    });
  });
});

describe("agent attachment pill content", () => {
  it("presents external resources with their provider identity", () => {
    const content = getAgentAttachmentPillContent(
      {
        type: "text",
        mimeType: "text/plain",
        title: "ENG-123 Plugin attachments",
        text: "Linear issue ENG-123: Plugin attachments",
        externalResource: {
          provider: "linear",
          providerLabel: "Linear issue",
          resourceType: "issue",
          id: "issue-uuid",
          identifier: "ENG-123",
          title: "Plugin attachments",
          url: "https://linear.app/acme/issue/ENG-123/plugin-attachments",
        },
      },
      i18n.t,
    );

    expect(content.title).toBe("Plugin attachments");
    expect(content.subtitle).toBe("Linear issue ENG-123");
  });
});
