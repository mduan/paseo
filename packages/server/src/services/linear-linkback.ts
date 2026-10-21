/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
import type { LinearTicket } from "@getpaseo/protocol/messages";
import { parseLinearTicketUrl } from "@getpaseo/protocol/linear-tickets";
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt();

export type LinearLinkbackComment = {
  body: string;
  author?: { login?: string } | null;
};

// Issue cards embed descriptions whose related links are not PR associations.
function linkedIssueContent(body: string): string {
  const source = body.replace(/<!--[\s\S]*?-->/g, "");
  const sections: string[] = [];
  let depth = 0;
  let inSummary = false;
  let cursor = 0;
  for (const tag of source.matchAll(/<\/?(details|summary)\b[^>]*>/gi)) {
    if (!depth || (depth === 1 && inSummary)) {
      sections.push(source.slice(cursor, tag.index));
    }
    const closing = tag[0].startsWith("</");
    if (tag[1].toLowerCase() === "details") {
      depth = closing ? Math.max(0, depth - 1) : depth + 1;
      if (!depth) inSummary = false;
    } else if (depth === 1) {
      inSummary = !closing;
    }
    cursor = tag.index + tag[0].length;
  }
  if (!depth || (depth === 1 && inSummary)) sections.push(source.slice(cursor));
  return sections.join("\n");
}

export function extractLinearTickets(comments: readonly LinearLinkbackComment[]): LinearTicket[] {
  const tickets = new Map<string, LinearTicket>();
  for (const comment of comments) {
    if (
      !/^(?:linear|linear-code)(?:\[bot\])?$/i.test(comment.author?.login ?? "") ||
      !comment.body.includes("<!-- linear-linkback -->")
    ) {
      continue;
    }
    const body = linkedIssueContent(comment.body);
    const links = [
      ...Array.from(
        body.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi),
        (match) => ({ url: match[2], label: match[3] }),
      ),
      ...Array.from(
        body.matchAll(/\[([^\]]+)\]\((https:\/\/linear\.app\/[^\s)]+)\)/g),
        (match) => ({ url: match[2], label: match[1] }),
      ),
    ];
    for (const link of links) {
      const url = markdown.utils.unescapeAll(link.url);
      const ticket = parseLinearTicketUrl(url);
      if (!ticket) continue;
      const { identifier } = ticket;
      const label = markdown.utils
        .unescapeAll(link.label.replace(/<[^>]*>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
      const title = label.replace(new RegExp(`^${identifier}\\b[\\s:–—-]*`, "i"), "").trim();
      const key = ticket.url;
      const existing = tickets.get(key);
      if (!existing || (!existing.title && title)) {
        tickets.set(key, { identifier, url, ...(title ? { title } : {}) });
      }
    }
  }
  return [...tickets.values()];
}
