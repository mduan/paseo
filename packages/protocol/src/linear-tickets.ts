import type { LinearTicket } from "./messages.js";

/** Full URLs carry organization identity without requiring Linear authentication. */
export function parseLinearTicketUrl(value: string): LinearTicket | undefined {
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

export function mergeLinearTickets(
  ...sources: readonly (readonly LinearTicket[] | undefined)[]
): LinearTicket[] {
  const tickets = new Map<string, LinearTicket>();
  for (const ticket of sources.flatMap((source) => source ?? [])) {
    const normalized = parseLinearTicketUrl(ticket.url);
    if (!normalized) continue;
    const existing = tickets.get(normalized.url);
    tickets.set(normalized.url, {
      ...normalized,
      ...(existing ?? ticket),
      title: existing?.title || ticket.title,
    });
  }
  return [...tickets.values()];
}

export function updateLinearTickets({
  current,
  add = [],
  remove = [],
}: {
  current?: readonly LinearTicket[];
  add?: readonly string[];
  remove?: readonly string[];
}): LinearTicket[] {
  const parse = (url: string): LinearTicket => {
    const ticket = parseLinearTicketUrl(url);
    if (!ticket)
      throw new Error(
        `Invalid Linear issue URL: ${url}. Use a full https://linear.app/<organization>/issue/<identifier> URL.`,
      );
    return ticket;
  };
  const additions = add.map(parse);
  const removals = new Set(remove.map(parse).map((ticket) => ticket.url));
  return mergeLinearTickets(current, additions).filter(
    (ticket) => !removals.has(parse(ticket.url).url),
  );
}
