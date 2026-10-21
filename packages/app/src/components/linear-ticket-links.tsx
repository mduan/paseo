import { Fragment } from "react";
import type { LinearTicket } from "@getpaseo/protocol/messages";
import type { StyleProp, TextStyle } from "react-native";
import { MarkdownLinkText } from "@/components/markdown/link-text";

export function LinearTicketLinks({
  tickets,
  style,
}: {
  tickets: readonly LinearTicket[];
  style?: StyleProp<TextStyle>;
}) {
  return tickets.map((ticket, index) => (
    <Fragment key={ticket.url}>
      {index > 0 ? ", " : undefined}
      <MarkdownLinkText href={ticket.url} style={style}>
        {ticket.identifier}
      </MarkdownLinkText>
    </Fragment>
  ));
}
