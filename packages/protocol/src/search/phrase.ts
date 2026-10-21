import type { SearchOptions } from "./options.js";

export class SearchQueryError extends Error {}

export function createPhrasePattern({
  query,
  options = {},
  literal = false,
}: {
  query: string;
  options?: SearchOptions;
  literal?: boolean;
}): RegExp {
  let source = query;
  if (!options.regex) {
    source = literal ? query : query.trim();
    source = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!literal) source = source.replace(/\s+/g, "\\s+");
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
