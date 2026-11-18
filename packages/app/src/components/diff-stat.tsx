import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { formatDiffCount } from "@/git/file-header-presentation";

interface DiffStatProps {
  additions: number;
  deletions: number;
  fileCount?: number;
  testID?: string;
}

export function DiffStat({ additions, deletions, fileCount, testID }: DiffStatProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.additions}>+{formatDiffCount(additions)}</Text>
      <Text style={styles.deletions}>-{formatDiffCount(deletions)}</Text>
      {fileCount === undefined ? null : (
        <Text style={styles.files} numberOfLines={1}>
          {`· ${t("diffStat.files", { count: fileCount })}`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 20,
    gap: 4,
    flexShrink: 0,
  },
  additions: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusSuccess,
  },
  deletions: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusDanger,
  },
  files: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
}));
