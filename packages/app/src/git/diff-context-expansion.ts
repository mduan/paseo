import { useCallback, useMemo } from "react";
import { create } from "zustand";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  applyDiffContextLines,
  diffGaps,
  diffHunkSignature,
  gapRangeToExpand,
  type ContextLine,
  type ExpandDiffGapInput,
} from "./diff-gaps";

interface FileExpansion {
  signature: string;
  lines: ReadonlyMap<number, ContextLine>;
}

interface DiffContextExpansionStore {
  expansions: Record<string, FileExpansion | undefined>;
  addLines: (input: { key: string; signature: string; lines: Map<number, ContextLine> }) => void;
}

// ponytail: in memory only, never pruned; one entry per expanded file per diff scope.
const useDiffContextExpansionStore = create<DiffContextExpansionStore>()((set) => ({
  expansions: {},
  addLines: ({ key, signature, lines }) =>
    set((state) => {
      const current = state.expansions[key];
      const merged = new Map(current?.signature === signature ? current.lines : undefined);
      for (const [lineNumber, line] of lines) merged.set(lineNumber, line);
      return { expansions: { ...state.expansions, [key]: { signature, lines: merged } } };
    }),
}));

const pendingExpansions = new Set<string>();
const expandedFileCache = new WeakMap<
  ParsedDiffFile,
  { expansion: FileExpansion; file: ParsedDiffFile }
>();

function expansionKey(scopeKey: string, path: string): string {
  return `${scopeKey}\n${path}`;
}

function expandFile(file: ParsedDiffFile, expansion: FileExpansion | undefined): ParsedDiffFile {
  if (!expansion || expansion.signature !== diffHunkSignature(file)) return file;
  const cached = expandedFileCache.get(file);
  if (cached?.expansion === expansion) return cached.file;
  const expanded = applyDiffContextLines(file, expansion.lines);
  expandedFileCache.set(file, { expansion, file: expanded });
  return expanded;
}

/**
 * Applies the expanded context lines of one diff scope (server, checkout, compare mode)
 * to its files. A file's expansions drop once its hunks move.
 */
export function useDiffContextExpansion(input: {
  serverId: string;
  cwd: string;
  scopeKey: string;
  files: ParsedDiffFile[];
}): { files: ParsedDiffFile[]; onExpandGap?: (expand: ExpandDiffGapInput) => void } {
  const { serverId, cwd, scopeKey, files } = input;
  const supported = useHostFeature(serverId, "diffExpandContext");
  const client = useHostRuntimeClient(serverId);
  const expansions = useDiffContextExpansionStore((state) => state.expansions);
  const addLines = useDiffContextExpansionStore((state) => state.addLines);

  const expandedFiles = useMemo(() => {
    if (!supported) return files;
    let changed = false;
    const next = files.map((file) => {
      const expanded = expandFile(file, expansions[expansionKey(scopeKey, file.path)]);
      changed ||= expanded !== file;
      return expanded;
    });
    return changed ? next : files;
  }, [expansions, files, scopeKey, supported]);

  const onExpandGap = useCallback(
    ({ path, gapIndex, direction }: ExpandDiffGapInput) => {
      const source = files.find((file) => file.path === path);
      const shown = expandedFiles.find((file) => file.path === path);
      const gap = shown ? diffGaps(shown)[gapIndex] : undefined;
      if (!client || !source || !gap) return;
      const key = expansionKey(scopeKey, path);
      if (pendingExpansions.has(key)) return;
      pendingExpansions.add(key);
      const range = gapRangeToExpand(gap, direction);
      void client
        .getDiffContextLines({
          cwd,
          path,
          ref: source.targetRef,
          startLine: range.start,
          lineCount: range.end - range.start,
        })
        .then((lines) => {
          addLines({
            key,
            signature: diffHunkSignature(source),
            lines: new Map(lines.map((line, index) => [range.start + index, line])),
          });
          return undefined;
        })
        .catch((error: unknown) => {
          console.warn("[DiffContext] Failed to expand context lines", error);
        })
        .finally(() => pendingExpansions.delete(key));
    },
    [addLines, client, cwd, expandedFiles, files, scopeKey],
  );

  return { files: expandedFiles, onExpandGap: supported ? onExpandGap : undefined };
}
