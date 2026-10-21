/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
type QueryPart = { text: string; quoted: boolean };

export function splitQuotedQuery(query: string): QueryPart[] {
  return query.split(/("[^"]*")/g).map((text, index) => ({
    text: index % 2 ? text.slice(1, -1) : text,
    quoted: index % 2 === 1,
  }));
}
