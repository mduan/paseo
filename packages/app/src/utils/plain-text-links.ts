import { createMarkdownParser } from "./markdown-parser";
import { isHttpUrl } from "./http-url";

// oxlint-disable-next-line typescript/consistent-type-definitions -- AGENTS.md requires type aliases.
type PlainTextPart = {
  start: number;
  text: string;
  href?: string;
};

const linkifier = createMarkdownParser({ linkify: true }).linkify;

export function splitPlainTextLinks(text: string): PlainTextPart[] {
  const parts: PlainTextPart[] = [];
  let position = 0;

  for (const match of linkifier.match(text) ?? []) {
    if (!isHttpUrl(match.url)) continue;
    if (match.index > position) {
      parts.push({ start: position, text: text.slice(position, match.index) });
    }
    parts.push({
      start: match.index,
      text: text.slice(match.index, match.lastIndex),
      href: match.url,
    });
    position = match.lastIndex;
  }

  if (position < text.length) {
    parts.push({ start: position, text: text.slice(position) });
  }
  return parts;
}
