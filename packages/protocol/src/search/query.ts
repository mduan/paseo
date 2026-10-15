/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
import type { SearchOptions } from "./options.js";
import {
  fuzzyPolicyForToken,
  matchRanges,
  scoreMatch,
  scoreTextFields,
  tokenizeQuery,
  type MatchRange,
} from "./text-match.js";

export type TextSearch = {
  matches: (fields: readonly string[]) => boolean;
  ranges: (text: string) => MatchRange[];
};

export class SearchQueryError extends Error {}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  ranges.sort((left, right) => left.start - right.start);
  const merged: MatchRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.start + last.length) {
      last.length = Math.max(last.length, range.start + range.length - last.start);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function createTextSearch({
  query,
  options = {},
}: {
  query: string;
  options?: SearchOptions;
}): TextSearch {
  if (!options.regex && !options.wholeWord && !options.caseSensitive) {
    return {
      matches: (fields) => scoreTextFields(query, [...fields], { typoTolerant: true }) !== null,
      ranges: (text) =>
        mergeRanges(
          tokenizeQuery(query).flatMap((token) => {
            const score = scoreMatch(token, text, { fuzzy: fuzzyPolicyForToken(token) });
            return score ? matchRanges(token, text, score) : [];
          }),
        ),
    };
  }
  const tokens = options.regex ? [query] : query.trim().split(/\s+/).filter(Boolean);
  // shortcut: native regex can block the main thread; isolate it if runtime limits become required.
  let patterns: RegExp[];
  try {
    patterns = tokens.map(
      (token) =>
        new RegExp(
          options.regex ? token : token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          options.caseSensitive ? "gu" : "giu",
        ),
    );
  } catch (error) {
    if (error instanceof SyntaxError) throw new SearchQueryError(error.message);
    throw error;
  }
  function rangesForPattern(pattern: RegExp, text: string): MatchRange[] {
    const ranges: MatchRange[] = [];
    // matchAll clones the expression, so repeated fields cannot inherit lastIndex.
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const wholeWord =
        !/[\p{L}\p{M}\p{N}_]$/u.test(text.slice(0, start)) &&
        !/^[\p{L}\p{M}\p{N}_]/u.test(text.slice(end));
      if (options.wholeWord && !options.regex && !wholeWord) continue;
      ranges.push({ start, length: end - start });
    }
    return ranges;
  }
  return {
    matches: (fields) =>
      patterns.every((pattern) =>
        fields.some((text) => rangesForPattern(pattern, text).length > 0),
      ),
    ranges: (text) =>
      mergeRanges(
        patterns
          .flatMap((pattern) => rangesForPattern(pattern, text))
          .filter((range) => range.length > 0),
      ),
  };
}
