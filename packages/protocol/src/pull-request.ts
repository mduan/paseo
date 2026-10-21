import { getForgeDefinitionOrNeutral } from "./forge-manifest.js";
import type { TextSearch } from "./search/query.js";
import type { MatchRange } from "./search/text-match.js";

export function parsePullRequestNumber(url: string): number | null {
  try {
    const pathname = new URL(url).pathname;
    // GitHub uses /pull/N, Gitea/Forgejo /pulls/N, GitLab /-/merge_requests/N.
    // Match any so a non-GitHub change-request summary yields a hint (and brand mark).
    const match = pathname.match(/\/(?:pull|pulls|merge_requests)\/(\d+)(?:\/|$)/);
    if (!match) {
      return null;
    }

    const number = Number.parseInt(match[1], 10);
    return Number.isFinite(number) ? number : null;
  } catch {
    return null;
  }
}

/** Keep prefixed searches highlighted when the badge displays only the number. */
export function pullRequestNumberRanges({
  number,
  forge,
  search,
}: {
  number: number;
  forge?: string;
  search?: TextSearch;
}): MatchRange[] {
  if (!search) return [];
  const label = String(number);
  const direct = search.ranges(label);
  if (direct.length) return direct;
  const prefix = getForgeDefinitionOrNeutral(forge ?? "github").changeRequestNumberPrefix;
  return search.ranges(`${prefix}${label}`).flatMap((range) => {
    const start = Math.max(range.start, prefix.length);
    const end = Math.min(range.start + range.length, prefix.length + label.length);
    return end > start ? [{ start: start - prefix.length, length: end - start }] : [];
  });
}
