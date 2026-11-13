import type { CommitRange } from "@/git/working-diff-comparison/state";

/** Positions of a range in a newest-first list: `newest <= oldest`. */
interface CommitRangeSpan {
  newest: number;
  oldest: number;
}

export function commitRangeSpan(
  shas: readonly string[],
  range: CommitRange | undefined,
): CommitRangeSpan | undefined {
  if (!range) return undefined;
  const newest = shas.indexOf(range.toSha);
  const oldest = shas.indexOf(range.fromSha);
  return newest === -1 || oldest === -1 || newest > oldest ? undefined : { newest, oldest };
}

/** Stays contiguous: an outside commit extends the range, an end shrinks it, an inside one collapses to it. */
export function toggleCommitInRange(input: {
  shas: readonly string[];
  range: CommitRange | undefined;
  sha: string;
}): CommitRange | undefined {
  const { shas, sha } = input;
  const index = shas.indexOf(sha);
  if (index === -1) return input.range;
  const span = commitRangeSpan(shas, input.range);
  const next = nextSpan(span, index);
  return next ? { fromSha: shas[next.oldest], toSha: shas[next.newest] } : undefined;
}

function nextSpan(span: CommitRangeSpan | undefined, index: number): CommitRangeSpan | undefined {
  if (!span) return { newest: index, oldest: index };
  if (index < span.newest || index > span.oldest) {
    return { newest: Math.min(span.newest, index), oldest: Math.max(span.oldest, index) };
  }
  if (span.newest === span.oldest) return undefined;
  if (index === span.newest) return { newest: index + 1, oldest: span.oldest };
  if (index === span.oldest) return { newest: span.newest, oldest: index - 1 };
  return { newest: index, oldest: index };
}
