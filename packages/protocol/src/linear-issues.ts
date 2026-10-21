import type { LinearIssue } from "./messages.js";

/** Full URLs carry organization identity without requiring Linear authentication. */
export function parseLinearIssueUrl(value: string): LinearIssue | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "linear.app" ||
    url.port ||
    url.username ||
    url.password
  ) {
    return undefined;
  }
  const match = /^\/([a-z0-9_-]+)\/issue\/([a-z][a-z0-9_]*-\d+)(?:\/[^/]*)?\/?$/i.exec(
    url.pathname,
  );
  if (!match) return undefined;
  const identifier = match[2].toUpperCase();
  return { identifier, url: `https://linear.app/${match[1].toLowerCase()}/issue/${identifier}` };
}

export function mergeLinearIssues(
  ...sources: readonly (readonly LinearIssue[] | undefined)[]
): LinearIssue[] {
  const issues = new Map<string, LinearIssue>();
  for (const issue of sources.flatMap((source) => source ?? [])) {
    const normalized = parseLinearIssueUrl(issue.url);
    if (!normalized) continue;
    const existing = issues.get(normalized.url);
    issues.set(normalized.url, {
      ...normalized,
      ...(existing ?? issue),
      title: existing?.title || issue.title,
    });
  }
  return [...issues.values()];
}

export function updateLinearIssues({
  current,
  add = [],
  remove = [],
}: {
  current?: readonly LinearIssue[];
  add?: readonly string[];
  remove?: readonly string[];
}): LinearIssue[] {
  const parse = (url: string): LinearIssue => {
    const issue = parseLinearIssueUrl(url);
    if (!issue)
      throw new Error(
        `Invalid Linear issue URL: ${url}. Use a full https://linear.app/<organization>/issue/<identifier> URL.`,
      );
    return issue;
  };
  const additions = add.map(parse);
  const removals = new Set(remove.map(parse).map((issue) => issue.url));
  return mergeLinearIssues(current, additions).filter(
    (issue) => !removals.has(parse(issue.url).url),
  );
}
