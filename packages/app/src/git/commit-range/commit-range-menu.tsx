import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Check } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { Button } from "@/components/ui/button";
import { MenuHint, MenuLabel, MenuSeparator, useMenuContext } from "@/components/ui/menu";
import { formatDiffCount, sumDiffStat } from "@/git/file-header-presentation";
import { useCheckoutCommitsQuery, type ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import type { CommitRange } from "@/git/working-diff-comparison/state";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { normalizeBranchOptionName } from "@/utils/branch-suggestions";
import { commitRangeSpan, toggleCommitInRange } from "./commit-range";

const ThemedCheck = withUnistyles(Check);
const checkedIconMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const EMPTY_COMMITS: ClassifiedCheckoutCommit[] = [];
// Lets the menu's keyboard navigation reach these rows, as it reaches `MenuItem`'s.
const MENU_ITEM_DATASET = { menuItem: "true", menuDisabled: "false" };

const shortSha = (sha: string) => sha.slice(0, 7);

/** "Commit abc1234" for one commit; "3 commits" when the count is known, else "abc1234..def5678". */
export function formatCommitRange(input: {
  t: TFunction;
  range: CommitRange;
  count?: number;
}): string {
  const { t, range, count } = input;
  if (range.fromSha === range.toSha) {
    return t("workspace.git.diff.commits.single", { sha: shortSha(range.fromSha) });
  }
  return count
    ? t("workspace.git.diff.commits.count", { count })
    : `${shortSha(range.fromSha)}..${shortSha(range.toSha)}`;
}

/** The checkout's commits ahead of base, newest first. */
export function useWorkspaceCommits(input: { serverId: string; cwd: string; enabled: boolean }) {
  const query = useCheckoutCommitsQuery(input);
  const data = query.status === "loaded" ? query.data : undefined;
  const commits = useMemo(
    () => (data ? data.commits.filter((commit) => !commit.isOnBase) : EMPTY_COMMITS),
    [data],
  );
  const shas = useMemo(() => commits.map((commit) => commit.sha), [commits]);
  return { query, commits, shas };
}

/** Checkbox clicks edit a contiguous draft range; Save applies it. */
export function CommitRangeMenuSection({
  serverId,
  cwd,
  selected,
  onSave,
}: {
  serverId: string;
  cwd: string;
  selected: CommitRange | undefined;
  onSave: (range: CommitRange) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const { open: isOpen, selectItem } = useMenuContext("CommitRangeMenuSection");
  const { query, commits, shas } = useWorkspaceCommits({ serverId, cwd, enabled: isOpen });
  const [draft, setDraft] = useState(selected);
  useEffect(() => {
    if (isOpen) setDraft(selected);
  }, [isOpen, selected]);

  // A range from before a rebase or base change no longer matches the list.
  const span = commitRangeSpan(shas, draft);
  const validDraft = span ? draft : undefined;
  const toggle = useCallback(
    (sha: string) => setDraft((range) => toggleCommitInRange({ shas, range, sha })),
    [shas],
  );
  const clear = useCallback(() => selectItem(() => setDraft(undefined), false), [selectItem]);
  const cancel = useCallback(() => selectItem(undefined, true), [selectItem]);
  const save = useCallback(() => {
    if (validDraft) selectItem(() => onSave(validDraft), true);
  }, [onSave, selectItem, validDraft]);
  const clearButton = useMemo(
    () =>
      validDraft ? (
        <Button variant="link" size="xs" onPress={clear} testID="commit-range-clear">
          {t("workspace.git.diff.commits.clear")}
        </Button>
      ) : null,
    [clear, t, validDraft],
  );

  if (query.status === "unsupported") return null;

  let body: ReactElement;
  if (query.status === "error") {
    body = <MenuHint>{t("workspace.git.diff.commits.loadError")}</MenuHint>;
  } else if (query.status !== "loaded") {
    body = <MenuHint>{t("workspace.git.diff.commits.loading")}</MenuHint>;
  } else if (commits.length === 0) {
    const baseRef = normalizeBranchOptionName(query.data.baseRef) ?? t("workspace.git.diff.base");
    body = <MenuHint>{t("workspace.git.diff.commits.noneAhead", { baseRef })}</MenuHint>;
  } else {
    body = (
      // ponytail: plain ScrollView; the sheet presentation may need its gesture-aware list.
      <ScrollView style={styles.list}>
        {commits.map((commit, index) => (
          <CommitRangeItem
            key={commit.sha}
            commit={commit}
            checked={Boolean(span && index >= span.newest && index <= span.oldest)}
            rangeStart={span?.newest === index}
            rangeEnd={span?.oldest === index}
            onToggle={toggle}
          />
        ))}
      </ScrollView>
    );
  }

  const unchanged =
    validDraft?.fromSha === selected?.fromSha && validDraft?.toSha === selected?.toSha;
  const draftCount = span ? span.oldest - span.newest + 1 : 0;
  return (
    <>
      <MenuSeparator />
      <MenuLabel trailing={clearButton}>{t("workspace.git.diff.commits.rangeTitle")}</MenuLabel>
      {body}
      <View style={styles.footer}>
        <Button variant="ghost" size="xs" onPress={cancel} testID="commit-range-cancel">
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="xs"
          onPress={save}
          disabled={!validDraft || unchanged}
          testID="commit-range-save"
        >
          {draftCount > 1
            ? t("workspace.git.diff.commits.showCount", { count: draftCount })
            : t("workspace.git.diff.commits.save")}
        </Button>
      </View>
    </>
  );
}

/**
 * A multi-line row the generic `MenuItem` can't draw: the title wraps, the checkbox sits on its
 * first line, and checked rows join into one band. The press still goes through `selectItem`.
 */
function CommitRangeItem({
  commit,
  checked,
  rangeStart,
  rangeEnd,
  onToggle,
}: {
  commit: ClassifiedCheckoutCommit;
  checked: boolean;
  rangeStart: boolean;
  rangeEnd: boolean;
  onToggle: (sha: string) => void;
}) {
  const { selectItem } = useMenuContext("CommitRangeItem");
  const timeAgo = useTimeAgo(new Date(commit.authorDate));
  const stat = useMemo(() => sumDiffStat(commit.files), [commit.files]);
  const handlePress = useCallback(
    () => selectItem(() => onToggle(commit.sha), false),
    [commit.sha, onToggle, selectItem],
  );
  const accessibilityState = useMemo(() => ({ checked }), [checked]);
  const pressableStyle = useCallback(
    ({
      pressed,
      hovered = false,
      focused = false,
    }: PressableStateCallbackType & { hovered?: boolean; focused?: boolean }) => {
      const highlighted = hovered || focused || pressed;
      if (!checked) return [styles.row, highlighted ? styles.rowHovered : null];
      return [
        styles.row,
        styles.rowChecked,
        rangeStart ? styles.rowRangeStart : null,
        rangeEnd ? styles.rowRangeEnd : null,
        highlighted ? styles.rowCheckedHovered : null,
      ];
    },
    [checked, rangeEnd, rangeStart],
  );
  return (
    <Pressable
      testID={`commit-range-row-${commit.shortSha}`}
      accessibilityRole="menuitem"
      accessibilityState={accessibilityState}
      aria-checked={checked}
      tabIndex={-1}
      dataSet={MENU_ITEM_DATASET}
      onPress={handlePress}
      style={pressableStyle}
    >
      {checked && !rangeStart ? <View style={[styles.rail, styles.railAbove]} /> : null}
      {checked && !rangeEnd ? <View style={[styles.rail, styles.railBelow]} /> : null}
      <View style={checked ? [styles.checkbox, styles.checkboxChecked] : styles.checkbox}>
        {checked ? <ThemedCheck size={12} uniProps={checkedIconMapping} /> : null}
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.title}>{commit.subject}</Text>
        <Text style={styles.meta}>
          {`${commit.authorName} · ${timeAgo} · `}
          <Text style={styles.additions}>+{formatDiffCount(stat.additions)}</Text>{" "}
          <Text style={styles.deletions}>-{formatDiffCount(stat.deletions)}</Text>
          {" · "}
          <Text style={styles.sha}>{commit.shortSha}</Text>
        </Text>
      </View>
    </Pressable>
  );
}

const TITLE_LINE_HEIGHT = 18;
const CHECKBOX_SIZE = 16;
const RAIL_WIDTH = 2;

const styles = StyleSheet.create((theme) => ({
  list: {
    maxHeight: 360,
  },
  // `MenuItem`'s box (inset, border, padding), so the title lands on the menu's text rail.
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    marginHorizontal: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
    borderRadius: theme.borderRadius.md,
    outlineWidth: 0,
    outlineColor: "transparent",
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  // Checked rows square off their corners so adjacent ones read as one band; the band's ends
  // take the row radius back.
  rowChecked: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 0,
  },
  rowRangeStart: {
    borderTopLeftRadius: theme.borderRadius.md,
    borderTopRightRadius: theme.borderRadius.md,
  },
  rowRangeEnd: {
    borderBottomLeftRadius: theme.borderRadius.md,
    borderBottomRightRadius: theme.borderRadius.md,
  },
  rowCheckedHovered: {
    backgroundColor: theme.colors.surface3,
  },
  // Joins the checkboxes of a multi-commit range; each half reaches the row edge it shares.
  rail: {
    position: "absolute",
    left: theme.spacing[2] + (CHECKBOX_SIZE - RAIL_WIDTH) / 2,
    width: RAIL_WIDTH,
    backgroundColor: theme.colors.accent,
    opacity: theme.opacity[50],
  },
  railAbove: {
    top: -theme.borderWidth[1],
    height: theme.spacing[1] + TITLE_LINE_HEIGHT / 2 + theme.borderWidth[1],
  },
  railBelow: {
    top: theme.spacing[1] + TITLE_LINE_HEIGHT / 2,
    bottom: -theme.borderWidth[1],
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: theme.fontSize.base,
    lineHeight: TITLE_LINE_HEIGHT,
    color: theme.colors.foreground,
  },
  meta: {
    marginTop: 2,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  additions: {
    color: theme.colors.statusSuccess,
  },
  deletions: {
    color: theme.colors.statusDanger,
  },
  sha: {
    fontFamily: theme.fontFamily.mono,
  },
  checkbox: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    // Centres the box on the title's first line.
    marginTop: (TITLE_LINE_HEIGHT - CHECKBOX_SIZE) / 2,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    marginTop: theme.spacing[1],
    padding: theme.spacing[2],
  },
}));
