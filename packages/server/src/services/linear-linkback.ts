/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
import type { LinearTicket } from "@getpaseo/protocol/messages";
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt();

export type LinearLinkbackComment = {
  body: string;
  author?: { login?: string } | null;
};

export function extractLinearTickets(comments: readonly LinearLinkbackComment[]): LinearTicket[] {
  const tickets = new Map<string, LinearTicket>();
  for (const comment of comments) {
    if (
      !/^(?:linear|linear-code)(?:\[bot\])?$/i.test(comment.author?.login ?? "") ||
      !comment.body.includes("<!-- linear-linkback -->")
    ) {
      continue;
    }
    const links = [
      ...Array.from(
        comment.body.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi),
        (match) => ({ url: match[2], label: match[3] }),
      ),
      ...Array.from(
        comment.body.matchAll(/\[([^\]]+)\]\((https:\/\/linear\.app\/[^\s)]+)\)/g),
        (match) => ({ url: match[2], label: match[1] }),
      ),
    ];
    for (const link of links) {
      let url: URL;
      try {
        url = new URL(markdown.utils.unescapeAll(link.url));
      } catch {
        continue;
      }
      if (
        url.protocol !== "https:" ||
        url.hostname !== "linear.app" ||
        url.port ||
        url.username ||
        url.password
      ) {
        continue;
      }
      const match = /^\/([^/]+)\/issue\/([a-z][a-z0-9_]*-\d+)(?:\/[^/]*)?\/?$/i.exec(url.pathname);
      if (!match) continue;
      const identifier = match[2].toUpperCase();
      const label = markdown.utils
        .unescapeAll(link.label.replace(/<[^>]*>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
      const title = label.replace(new RegExp(`^${identifier}\\b[\\s:–—-]*`, "i"), "").trim();
      const key = `${match[1].toLowerCase()}/${identifier}`;
      const existing = tickets.get(key);
      if (!existing || (!existing.title && title)) {
        tickets.set(key, { identifier, url: url.href, ...(title ? { title } : {}) });
      }
    }
  }
  return [...tickets.values()];
}
