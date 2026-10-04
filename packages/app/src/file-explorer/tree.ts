import type { ExplorerDirectory, ExplorerEntry } from "@/stores/session-store";
import type { SortOption } from "@/stores/panel-store/state";
import { filterVisibleExplorerEntries } from "./visibility";

export const MAX_AUTO_EXPANDED_DIRECTORY_DEPTH = 5;

export interface ExplorerTreeRow {
  entry: ExplorerEntry;
  depth: number;
}

interface FlattenExplorerTreeInput {
  directories: ReadonlyMap<string, ExplorerDirectory>;
  expandedPaths: ReadonlySet<string>;
  sortOption: SortOption;
  showHiddenFiles: boolean;
}

interface RestoreExpandedDirectoriesInput {
  rootDirectory: ExplorerDirectory;
  persistedExpandedPaths: ReadonlySet<string>;
  showHiddenFiles: boolean;
  requestDirectoryListing: (path: string) => Promise<ExplorerDirectory | null>;
}

interface ShowHiddenFilesAndRestoreExpandedDirectoriesInput extends Omit<
  RestoreExpandedDirectoriesInput,
  "showHiddenFiles"
> {
  showHiddenFiles: () => void;
}

interface ReconcileRestoredExpandedPathsInput {
  persistedExpandedPaths: ReadonlySet<string>;
  currentExpandedPaths: ReadonlySet<string>;
  restoredExpandedPaths: string[];
}

interface SetExpandedDirectoryPathInput {
  currentExpandedPaths: readonly string[];
  directoryPath: string;
  expanded: boolean;
}

export function flattenExplorerTree({
  directories,
  expandedPaths,
  sortOption,
  showHiddenFiles,
}: FlattenExplorerTreeInput): ExplorerTreeRow[] {
  const root = directories.get(".");
  if (!root) {
    return [];
  }

  const rows: ExplorerTreeRow[] = [];
  const pending = rowsForDirectory(root, 0, sortOption, showHiddenFiles).toReversed();

  while (pending.length > 0) {
    const row = pending.pop();
    if (!row) {
      break;
    }
    rows.push(row);

    const entry = row.entry;
    if (entry.kind !== "directory" || !expandedPaths.has(entry.path)) {
      continue;
    }
    const childDirectory = directories.get(entry.path);
    if (!childDirectory) {
      continue;
    }
    const childRows = rowsForDirectory(childDirectory, row.depth + 1, sortOption, showHiddenFiles);
    for (let index = childRows.length - 1; index >= 0; index -= 1) {
      pending.push(childRows[index]);
    }
  }

  return rows;
}

export async function restoreExpandedDirectories({
  rootDirectory,
  persistedExpandedPaths,
  showHiddenFiles,
  requestDirectoryListing,
}: RestoreExpandedDirectoriesInput): Promise<string[]> {
  // The root row is collapsible, so "." restores only when it was persisted as expanded.
  const restoredPaths = persistedExpandedPaths.has(".") ? ["."] : [];
  const restoredPathSet = new Set(["."]);
  let parentDirectories = [rootDirectory];

  for (let depth = 1; depth <= MAX_AUTO_EXPANDED_DIRECTORY_DEPTH; depth += 1) {
    const pathsToRequest: string[] = [];
    for (const directory of parentDirectories) {
      const entries = filterVisibleExplorerEntries(directory.entries, showHiddenFiles);
      for (const entry of entries) {
        const isPersistedExpandedDirectory =
          entry.kind === "directory" && persistedExpandedPaths.has(entry.path);
        if (isPersistedExpandedDirectory && !restoredPathSet.has(entry.path)) {
          pathsToRequest.push(entry.path);
          restoredPathSet.add(entry.path);
        }
      }
    }
    if (pathsToRequest.length === 0) {
      break;
    }

    const requestedDirectories = await Promise.all(
      pathsToRequest.map((path) => requestDirectoryListing(path)),
    );
    parentDirectories = [];
    for (const directory of requestedDirectories) {
      if (!directory) {
        continue;
      }
      restoredPaths.push(directory.path);
      parentDirectories.push(directory);
    }
  }

  return restoredPaths;
}

export function showHiddenFilesAndRestoreExpandedDirectories({
  rootDirectory,
  persistedExpandedPaths,
  showHiddenFiles,
  requestDirectoryListing,
}: ShowHiddenFilesAndRestoreExpandedDirectoriesInput): Promise<string[]> {
  showHiddenFiles();
  return restoreExpandedDirectories({
    rootDirectory,
    persistedExpandedPaths,
    showHiddenFiles: true,
    requestDirectoryListing,
  });
}

export function reconcileRestoredExpandedPaths({
  persistedExpandedPaths,
  currentExpandedPaths,
  restoredExpandedPaths,
}: ReconcileRestoredExpandedPathsInput): string[] {
  const reconciledPaths = new Set(restoredExpandedPaths);

  for (const path of persistedExpandedPaths) {
    if (!currentExpandedPaths.has(path)) {
      reconciledPaths.delete(path);
    }
  }
  for (const path of currentExpandedPaths) {
    if (!persistedExpandedPaths.has(path)) {
      reconciledPaths.add(path);
    }
  }

  return Array.from(reconciledPaths);
}

export function setExpandedDirectoryPath({
  currentExpandedPaths,
  directoryPath,
  expanded,
}: SetExpandedDirectoryPathInput): string[] {
  const nextPaths = new Set(currentExpandedPaths);
  if (expanded) {
    nextPaths.add(directoryPath);
  } else {
    nextPaths.delete(directoryPath);
  }
  return Array.from(nextPaths);
}

/** The directories that must be expanded for `path` to show in the tree, root first. */
export function explorerAncestorPaths(path: string): string[] {
  const segments = path.split("/");
  return [".", ...segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"))];
}

// ponytail: hard cap so "Expand all" on a node_modules-heavy root can't fire thousands of listings.
export const MAX_EXPAND_ALL_DIRECTORIES = 500;

/**
 * Lists `rootPath` and every visible directory below it, one level per batch, and reports
 * each listed level so the tree grows while deeper levels load.
 */
export async function expandDirectoryTree({
  rootPath,
  showHiddenFiles,
  requestDirectoryListing,
  onLevelListed,
}: {
  rootPath: string;
  showHiddenFiles: boolean;
  requestDirectoryListing: (path: string) => Promise<ExplorerDirectory | null>;
  onLevelListed: (paths: string[]) => void;
}): Promise<void> {
  let level = [rootPath];
  let listedCount = 0;
  while (level.length > 0 && listedCount < MAX_EXPAND_ALL_DIRECTORIES) {
    level = level.slice(0, MAX_EXPAND_ALL_DIRECTORIES - listedCount);
    listedCount += level.length;
    const listed = (await Promise.all(level.map(requestDirectoryListing))).filter(
      (directory): directory is ExplorerDirectory => directory !== null,
    );
    onLevelListed(listed.map((directory) => directory.path));
    level = listed.flatMap((directory) =>
      filterVisibleExplorerEntries(directory.entries, showHiddenFiles)
        .filter((entry) => entry.kind === "directory")
        .map((entry) => entry.path),
    );
  }
}

function rowsForDirectory(
  directory: ExplorerDirectory,
  depth: number,
  sortOption: SortOption,
  showHiddenFiles: boolean,
): ExplorerTreeRow[] {
  const visibleEntries = filterVisibleExplorerEntries(directory.entries, showHiddenFiles);
  const sortedEntries = sortExplorerEntries(visibleEntries, sortOption);
  return sortedEntries.map((entry) => ({ entry, depth }));
}

function sortExplorerEntries(entries: ExplorerEntry[], sortOption: SortOption): ExplorerEntry[] {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    switch (sortOption) {
      case "name":
        return a.name.localeCompare(b.name);
      case "modified":
        return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      case "size":
        return b.size - a.size;
    }
  });
  return sorted;
}
