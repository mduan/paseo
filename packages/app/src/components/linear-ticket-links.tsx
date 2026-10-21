import { Fragment } from "react";
import type { LinearTicket } from "@getpaseo/protocol/messages";
import type { TextSearch } from "@getpaseo/protocol/search/query";
import { HighlightedText } from "@/components/ui/highlighted-text";
import type { StyleProp, TextStyle } from "react-native";
import { MarkdownLinkText } from "@/components/markdown/link-text";

export function LinearTicketLinks({
  tickets,
  style,
  search,
}: {
  tickets: readonly LinearTicket[];
  style?: StyleProp<TextStyle>;
  search?: TextSearch;
}) {
  return tickets.map((ticket, index) => (
    <Fragment key={ticket.url}>
      {index > 0 ? ", " : undefined}
      <MarkdownLinkText href={ticket.url} style={style}>
        {search ? (
          <HighlightedText text={ticket.identifier} ranges={search.ranges(ticket.identifier)} />
        ) : (
          ticket.identifier
        )}
      </MarkdownLinkText>
    </Fragment>
  ));
}
