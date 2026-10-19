import type { SearchOptions } from "./options.js";

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
    source = query
      .trim()
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
  }
  if (options.wholeWord) {
    source = String.raw`(?<![\p{L}\p{M}\p{N}_])(?:${source})(?![\p{L}\p{M}\p{N}_])`;
  }
  try {
    return new RegExp(source, options.caseSensitive ? "gu" : "giu");
  } catch (error) {
    if (error instanceof SyntaxError) throw new SearchQueryError(error.message);
    throw error;
  }
}
