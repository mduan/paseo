import { createContext, memo, useCallback, useContext, useMemo, useState } from "react";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Diff } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { TurnDiffFileStat, TurnDiffSummary } from "@getpaseo/protocol/messages";
import { Button } from "@/components/ui/button";
import { DiffStat } from "@/components/diff-stat";
import type { Theme } from "@/styles/theme";

const COLLAPSED_FILE_COUNT = 3;

export interface OpenTurnDiffInput {
  turnId: string;
  focusPath?: string;
}

export interface TurnDiffCardsValue {
  /** Summaries keyed by the stream item the turn footer renders under. */
  anchors: ReadonlyMap<string, TurnDiffSummary>;
  onOpen?: (input: OpenTurnDiffInput) => void;
}

export const TurnDiffCardsContext = createContext<TurnDiffCardsValue | undefined>(undefined);

/** Renders the turn's diff card when `itemId` hosts a completed turn that changed files. */
export function TurnDiffCardSlot({ itemId }: { itemId: string }) {
  const value = useContext(TurnDiffCardsContext);
  const summary = value?.anchors.get(itemId);
  if (!summary) return null;
  return (
    <View style={styles.slot}>
      <TurnDiffCard summary={summary} onOpen={value?.onOpen} />
    </View>
  );
}

const ThemedDiff = withUnistyles(Diff);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronUp = withUnistyles(ChevronUp);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

function splitPath(path: string): { directory: string; name: string } {
  const slash = path.lastIndexOf("/");
  return { directory: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

function sumStat(files: TurnDiffFileStat[], key: "additions" | "deletions"): number {
  return files.reduce((total, file) => total + (file[key] ?? 0), 0);
}

const TurnDiffCard = memo(function TurnDiffCard({
  summary,
  onOpen,
}: {
  summary: TurnDiffSummary;
  onOpen?: (input: OpenTurnDiffInput) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { files, turnId } = summary;
  const additions = useMemo(() => sumStat(files, "additions"), [files]);
  const deletions = useMemo(() => sumStat(files, "deletions"), [files]);
  const title =
    files.length === 1
      ? t("turnDiff.editedFile", { name: splitPath(files[0]!.path).name })
      : t("turnDiff.editedFiles", { count: files.length });
  const visibleFiles = expanded ? files : files.slice(0, COLLAPSED_FILE_COUNT);
  const hiddenCount = files.length - COLLAPSED_FILE_COUNT;
  const showFileList = files.length > 1;

  const handleViewChanges = useCallback(() => onOpen?.({ turnId }), [onOpen, turnId]);
  const handleToggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const toggleIcon = useMemo(() => {
    const Chevron = expanded ? ThemedChevronUp : ThemedChevronDown;
    return <Chevron size={14} uniProps={mutedColorMapping} />;
  }, [expanded]);

  return (
    <View style={styles.card} testID="turn-diff-card">
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <ThemedDiff size={16} uniProps={foregroundColorMapping} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <DiffStat additions={additions} deletions={deletions} />
        </View>
        {onOpen ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleViewChanges}
            testID="turn-diff-view-changes"
          >
            {t("turnDiff.viewChanges")}
          </Button>
        ) : null}
      </View>
      {showFileList
        ? visibleFiles.map((file) => (
            <TurnDiffFileRow key={file.path} file={file} turnId={turnId} onOpen={onOpen} />
          ))
        : null}
      {showFileList && hiddenCount > 0 ? (
        <View style={styles.row}>
          <Button
            variant="ghost"
            size="xs"
            onPress={handleToggleExpanded}
            trailing={toggleIcon}
            testID="turn-diff-toggle-files"
          >
            {expanded
              ? t("turnDiff.showFewerFiles")
              : t("turnDiff.showMoreFiles", { count: hiddenCount })}
          </Button>
        </View>
      ) : null}
    </View>
  );
});

function TurnDiffFileRow({
  file,
  turnId,
  onOpen,
}: {
  file: TurnDiffFileStat;
  turnId: string;
  onOpen?: (input: OpenTurnDiffInput) => void;
}) {
  const { directory, name } = splitPath(file.path);
  const handlePress = useCallback(
    () => onOpen?.({ turnId, focusPath: file.path }),
    [file.path, onOpen, turnId],
  );
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      onOpen && (hovered || pressed) && styles.rowHovered,
    ],
    [onOpen],
  );
  return (
    <Pressable
      accessibilityRole={onOpen ? "button" : undefined}
      disabled={!onOpen}
      onPress={handlePress}
      style={rowStyle}
      testID="turn-diff-file"
    >
      <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
        <Text style={styles.directory}>{directory}</Text>
        {name}
      </Text>
      <DiffStat additions={file.additions ?? 0} deletions={file.deletions ?? 0} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Same rails as the stream rows and turn footer around it.
  slot: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[3],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  path: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  directory: {
    color: theme.colors.foregroundMuted,
  },
}));
