import { Fragment } from "react";
import type { LinearIssue } from "@getpaseo/protocol/messages";
import type { TextSearch } from "@getpaseo/protocol/search/query";
import { HighlightedText } from "@/components/ui/highlighted-text";
import type { StyleProp, TextStyle } from "react-native";
import { MarkdownLinkText } from "@/components/markdown/link-text";

export function LinearIssueLinks({
  issues,
  style,
  search,
}: {
  issues: readonly LinearIssue[];
  style?: StyleProp<TextStyle>;
  search?: TextSearch;
}) {
  return issues.map((issue, index) => (
    <Fragment key={issue.url}>
      {index > 0 ? ", " : undefined}
      <MarkdownLinkText href={issue.url} style={style}>
        {search ? (
          <HighlightedText text={issue.identifier} ranges={search.ranges(issue.identifier)} />
        ) : (
          issue.identifier
        )}
      </MarkdownLinkText>
    </Fragment>
  ));
}
