import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Check } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { Button } from "@/components/ui/button";
import { MenuHint, MenuItem, MenuLabel, MenuSeparator, useMenuContext } from "@/components/ui/menu";
import { useCheckoutCommitsQuery, type ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import type { CommitRange } from "@/git/working-diff-comparison/state";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { normalizeBranchOptionName } from "@/utils/branch-suggestions";
import { commitRangeSpan, toggleCommitInRange } from "./commit-range";

const ThemedCheck = withUnistyles(Check);
const checkedIconMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const EMPTY_COMMITS: ClassifiedCheckoutCommit[] = [];

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
            onToggle={toggle}
          />
        ))}
      </ScrollView>
    );
  }

  const unchanged =
    validDraft?.fromSha === selected?.fromSha && validDraft?.toSha === selected?.toSha;
  return (
    <>
      <MenuSeparator />
      <MenuLabel trailing={clearButton}>{t("workspace.git.diff.commits.rangeTitle")}</MenuLabel>
      {body}
      <View style={styles.footer}>
        <Text style={styles.summary} numberOfLines={1}>
          {validDraft && span
            ? formatCommitRange({ t, range: validDraft, count: span.oldest - span.newest + 1 })
            : ""}
        </Text>
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
          {t("workspace.git.diff.commits.save")}
        </Button>
      </View>
    </>
  );
}

function CommitRangeItem({
  commit,
  checked,
  onToggle,
}: {
  commit: ClassifiedCheckoutCommit;
  checked: boolean;
  onToggle: (sha: string) => void;
}) {
  const timeAgo = useTimeAgo(new Date(commit.authorDate));
  const handleSelect = useCallback(() => onToggle(commit.sha), [commit.sha, onToggle]);
  const checkbox = useMemo(
    () => (
      <View style={checked ? [styles.checkbox, styles.checkboxChecked] : styles.checkbox}>
        {checked ? <ThemedCheck size={12} uniProps={checkedIconMapping} /> : null}
      </View>
    ),
    [checked],
  );
  return (
    <MenuItem
      testID={`commit-range-row-${commit.shortSha}`}
      closeOnSelect={false}
      onSelect={handleSelect}
      active={checked}
      leading={checkbox}
      description={`${commit.shortSha} · ${timeAgo}`}
    >
      {commit.subject}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    maxHeight: 360,
  },
  checkbox: {
    width: 16,
    height: 16,
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
    gap: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    marginTop: theme.spacing[1],
    padding: theme.spacing[2],
  },
  summary: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
