import { useMemo, type ReactElement } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  Copy,
  CopyX,
  FolderSearch,
  FolderOpen,
  Pencil,
  Sparkles,
  RotateCw,
  X,
} from "lucide-react-native";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import type { Theme } from "@/styles/theme";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedArrowLeftToLine = withUnistyles(ArrowLeftToLine);
const ThemedArrowRightToLine = withUnistyles(ArrowRightToLine);
const ThemedCopyX = withUnistyles(CopyX);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedFolderSearch = withUnistyles(FolderSearch);
const ThemedSparkles = withUnistyles(Sparkles);
const ThemedPencil = withUnistyles(Pencil);
const ThemedX = withUnistyles(X);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Icon and hint for a tab menu entry, shared by the tab context menu and the sidebar kebab. */
export function useWorkspaceTabMenuItemAdornments(
  entry: Extract<WorkspaceTabMenuEntry, { kind: "item" }>,
): { leading: ReactElement | undefined; trailing: ReactElement | undefined } {
  const leading = useMemo(() => {
    switch (entry.icon) {
      case "arrow-left":
        return <ThemedArrowLeft size={16} uniProps={mutedColorMapping} />;
      case "arrow-right":
        return <ThemedArrowRight size={16} uniProps={mutedColorMapping} />;
      case "arrow-up":
        return <ThemedArrowUp size={16} uniProps={mutedColorMapping} />;
      case "arrow-down":
        return <ThemedArrowDown size={16} uniProps={mutedColorMapping} />;
      case "copy":
        return <ThemedCopy size={16} uniProps={mutedColorMapping} />;
      case "rotate-cw":
        return <ThemedRotateCw size={16} uniProps={mutedColorMapping} />;
      case "arrow-left-to-line":
        return <ThemedArrowLeftToLine size={16} uniProps={mutedColorMapping} />;
      case "arrow-right-to-line":
        return <ThemedArrowRightToLine size={16} uniProps={mutedColorMapping} />;
      case "copy-x":
        return <ThemedCopyX size={16} uniProps={mutedColorMapping} />;
      case "folder-open":
        return <ThemedFolderOpen size={16} uniProps={mutedColorMapping} />;
      case "folder-search":
        return <ThemedFolderSearch size={16} uniProps={mutedColorMapping} />;
      case "sparkles":
        return <ThemedSparkles size={16} uniProps={mutedColorMapping} />;
      case "pencil":
        return <ThemedPencil size={16} uniProps={mutedColorMapping} />;
      case "x":
        return <ThemedX size={16} uniProps={mutedColorMapping} />;
      default:
        return undefined;
    }
  }, [entry.icon]);
  const trailing = useMemo(
    () => (entry.hint ? <Text style={styles.hint}>{entry.hint}</Text> : undefined),
    [entry.hint],
  );
  return { leading, trailing };
}

const styles = StyleSheet.create((theme) => ({
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
