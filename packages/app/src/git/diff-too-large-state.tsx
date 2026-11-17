import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { FileWarning, TriangleAlert } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { DiffStat } from "@/components/diff-stat";
import { sumDiffStat } from "@/git/file-header-presentation";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedFileWarning = withUnistyles(FileWarning);
const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const foregroundMutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const warningIconColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

export function DiffTooLargeState() {
  const { t } = useTranslation();

  return (
    <View style={styles.container} testID="diff-too-large">
      <ThemedFileWarning size={ICON_SIZE.lg} uniProps={foregroundMutedIconColorMapping} />
      <View style={styles.copy}>
        <Text style={styles.title}>{t("workspace.git.diff.previewTooLargeTitle")}</Text>
        <Text style={styles.description}>{t("workspace.git.diff.previewTooLargeDescription")}</Text>
      </View>
    </View>
  );
}

// ponytail: fixed heuristic; make it a setting if users hit it on intentionally large diffs.
const VERY_LARGE_DIFF_FILES = 300;
const VERY_LARGE_DIFF_LINES = 30_000;

interface DiffStatFile {
  additions: number;
  deletions: number;
}

function isVeryLargeDiff(files: readonly DiffStatFile[]) {
  if (files.length > VERY_LARGE_DIFF_FILES) return true;
  const { additions, deletions } = sumDiffStat(files);
  return additions + deletions > VERY_LARGE_DIFF_LINES;
}

interface DiffRef {
  name?: string;
  sha?: string;
}

export interface DiffComparisonRefs {
  from: DiffRef;
  to: DiffRef;
}

/** Asks before rendering a very large diff; stays open until `comparisonKey` changes. */
export function LargeDiffGate({
  files,
  comparisonKey,
  refs,
  onShowDiff,
  children,
}: {
  files: readonly DiffStatFile[];
  comparisonKey: string;
  refs: DiffComparisonRefs;
  onShowDiff: () => void;
  children: ReactNode;
}) {
  const veryLarge = useMemo(() => isVeryLargeDiff(files), [files]);
  const [shownKey, setShownKey] = useState<string>();
  const handleShowDiff = useCallback(() => {
    setShownKey(comparisonKey);
    onShowDiff();
  }, [comparisonKey, onShowDiff]);
  if (!veryLarge || shownKey === comparisonKey) return children;
  return <LargeDiffNotice files={files} refs={refs} onShowDiff={handleShowDiff} />;
}

function LargeDiffNotice({
  files,
  refs: { from, to },
  onShowDiff,
}: {
  files: readonly DiffStatFile[];
  refs: DiffComparisonRefs;
  onShowDiff: () => void;
}) {
  const { t } = useTranslation();
  const { additions, deletions } = sumDiffStat(files);

  return (
    <View style={styles.container} testID="large-diff-notice">
      <ThemedTriangleAlert size={ICON_SIZE.lg} uniProps={warningIconColorMapping} />
      <View style={styles.copy}>
        <Text style={styles.title}>{t("workspace.git.diff.largeDiffTitle")}</Text>
        <Text style={styles.description}>{t("workspace.git.diff.largeDiffDescription")}</Text>
      </View>
      <View style={styles.details}>
        {to.name || to.sha ? (
          <DetailRow label={t("workspace.git.diff.largeDiffTo")}>
            <RefText diffRef={to} />
          </DetailRow>
        ) : null}
        {from.name || from.sha ? (
          <DetailRow label={t("workspace.git.diff.largeDiffFrom")}>
            <RefText diffRef={from} />
          </DetailRow>
        ) : null}
        <DetailRow label={t("workspace.git.diff.largeDiffFiles")}>
          <Text style={styles.value}>
            {t("workspace.git.diff.largeDiffFileCount", { count: files.length })}
          </Text>
        </DetailRow>
        <DetailRow label={t("workspace.git.diff.largeDiffLines")}>
          <DiffStat additions={additions} deletions={deletions} />
        </DetailRow>
      </View>
      <Button variant="default" size="sm" onPress={onShowDiff} testID="large-diff-show">
        {t("workspace.git.diff.largeDiffShow")}
      </Button>
    </View>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.detailValue}>{children}</View>
    </View>
  );
}

function RefText({ diffRef }: { diffRef: DiffRef }) {
  return (
    <Text style={styles.ref} numberOfLines={1}>
      {diffRef.name}
      {diffRef.name && diffRef.sha ? " " : null}
      {diffRef.sha ? <Text style={styles.sha}>{diffRef.sha.slice(0, 7)}</Text> : null}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[16],
  },
  copy: {
    alignItems: "center",
    gap: theme.spacing[1],
    maxWidth: 360,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  details: {
    maxWidth: 400,
    width: "100%",
    gap: theme.spacing[1],
    padding: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 20,
  },
  label: {
    width: 56,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  detailValue: {
    flex: 1,
    minWidth: 0,
  },
  value: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  ref: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  sha: {
    color: theme.colors.foregroundExtraMuted,
  },
}));
