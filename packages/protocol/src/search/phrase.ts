import type { SearchOptions } from "./options.js";
import { splitQuotedQuery } from "./quoted-query.js";

export class SearchQueryError extends Error {}

export function createPhrasePattern({
  query,
  options = {},
}: {
  query: string;
  options?: SearchOptions;
}): RegExp {
  let source = query;
  if (!options.regex) {
    source = splitQuotedQuery(query.trim())
      .map(({ text, quoted }) => {
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return quoted ? escaped : escaped.replace(/\s+/g, "\\s+");
      })
      .join("");
  }
  try {
    const flags = options.caseSensitive ? "gu" : "giu";
    const pattern = new RegExp(source, flags);
    if (!options.wholeWord) return pattern;
    return new RegExp(
      String.raw`(?<![\p{L}\p{M}\p{N}_])(?:${source})(?![\p{L}\p{M}\p{N}_])`,
      flags,
    );
  } catch (error) {
    if (error instanceof SyntaxError) throw new SearchQueryError(error.message);
    throw error;
  }
}
