import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  Pressable,
  Text,
  View,
  type ListRenderItemInfo,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useWorkspaceFileSearch } from "@/command-center/workspace-file-search";
import type { WorkspaceFileSearchEntry } from "@/command-center/workspace-file-search-model";
import { MaterialFileIcon } from "@/components/material-file-icon";
import {
  treeRowPaddingLeft,
  workspaceTreeRowStyles,
  WORKSPACE_TREE_ICON_LABEL_GAP,
  WORKSPACE_TREE_ICON_SIZE,
} from "@/components/tree-primitives";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function rowStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    workspaceTreeRowStyles.row,
    styles.row,
    (Boolean(hovered) || pressed) && workspaceTreeRowStyles.active,
  ];
}

function keyExtractor(entry: WorkspaceFileSearchEntry): string {
  return entry.path;
}

function SearchResultRow({
  entry,
  onOpenFile,
}: {
  entry: WorkspaceFileSearchEntry;
  onOpenFile: (path: string) => void;
}) {
  const handlePress = useCallback(() => onOpenFile(entry.path), [entry.path, onOpenFile]);
  return (
    <Pressable
      onPress={handlePress}
      style={rowStyle}
      accessibilityRole="button"
      testID={`file-explorer-search-result-${entry.path}`}
    >
      <View style={styles.entryInfo}>
        <MaterialFileIcon fileName={entry.name} size={WORKSPACE_TREE_ICON_SIZE} />
        <Text style={[styles.name, workspaceTreeRowStyles.name]} numberOfLines={1}>
          {entry.name}
        </Text>
        {entry.directory ? (
          <Text style={styles.directory} numberOfLines={1}>
            {entry.directory}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Fuzzy-matched workspace files, ranked by the daemon (same search as `@` mentions and Cmd-K). */
export function FileExplorerSearchResults({
  serverId,
  workspaceId,
  query,
  onOpenFile,
}: {
  serverId: string;
  workspaceId: string | null;
  query: string;
  onOpenFile: (path: string) => void;
}) {
  const { t } = useTranslation();
  const { entries, loading, error } = useWorkspaceFileSearch({
    serverId,
    workspaceId,
    enabled: true,
    query,
  });
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<WorkspaceFileSearchEntry>) => (
      <SearchResultRow entry={item} onOpenFile={onOpenFile} />
    ),
    [onOpenFile],
  );

  if (error) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }
  if (entries.length === 0) {
    return (
      <View style={styles.centerState}>
        {loading ? (
          <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
        ) : (
          <Text style={styles.emptyText}>{t("workspace.fileExplorer.search.noResults")}</Text>
        )}
      </View>
    );
  }
  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={entries}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      keyboardShouldPersistTaps="handled"
      testID="file-explorer-search-results"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  row: {
    paddingLeft: treeRowPaddingLeft(0),
  },
  entryInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: WORKSPACE_TREE_ICON_LABEL_GAP,
    minWidth: 0,
  },
  name: {
    flexShrink: 0,
    maxWidth: "70%",
    fontSize: theme.fontSize.base,
    userSelect: "none",
  },
  directory: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    userSelect: "none",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
