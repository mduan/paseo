import { useCallback, useMemo } from "react";
import { create } from "zustand";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { DeferredDiffLoad } from "./deferred-diff-load";

type FileLoad =
  | { state: DeferredDiffLoad.Loading | DeferredDiffLoad.Failed }
  | { state: DeferredDiffLoad.Loaded; file: ParsedDiffFile };

interface DeferredDiffFilesStore {
  loads: Record<string, FileLoad | undefined>;
  setLoad: (key: string, load: FileLoad) => void;
}

// ponytail: in memory only, never pruned; one entry per loaded file version.
const useDeferredDiffFilesStore = create<DeferredDiffFilesStore>()((set) => ({
  loads: {},
  setLoad: (key, load) => set((state) => ({ loads: { ...state.loads, [key]: load } })),
}));

/** A file's version changes with its contents, so an edited file shows its load row again. */
function loadKey(input: {
  serverId: string;
  cwd: string;
  file: ParsedDiffFile;
  ignoreWhitespace: boolean;
}): string | undefined {
  const { file } = input;
  if (!file.deferred) return undefined;
  return JSON.stringify([
    input.serverId,
    input.cwd,
    file.path,
    file.oldPath,
    file.deferred.baseRef,
    file.targetRef,
    file.deferred.version,
    input.ignoreWhitespace,
  ]);
}

/** Keeps the placeholder's counts when the daemon cannot show the loaded file's lines. */
function displayedLoadedFile(
  placeholder: ParsedDiffFile,
  loaded: ParsedDiffFile | null,
): ParsedDiffFile {
  if (loaded?.status === "ok") return loaded;
  const { deferred: _deferred, ...file } = placeholder;
  // null means the file no longer differs.
  return { ...file, status: loaded?.status ?? "ok" };
}

/**
 * Replaces the deferred placeholders of large files the user loads with their diffs, and reports
 * which ones are still loading or failed.
 */
export function useDeferredDiffFiles(input: {
  serverId: string;
  cwd: string;
  files: ParsedDiffFile[];
  ignoreWhitespace: boolean;
}): {
  files: ParsedDiffFile[];
  loads: ReadonlyMap<string, DeferredDiffLoad>;
  loadFile: (path: string) => void;
} {
  const { serverId, cwd, files, ignoreWhitespace } = input;
  const client = useHostRuntimeClient(serverId);
  const loads = useDeferredDiffFilesStore((state) => state.loads);
  const setLoad = useDeferredDiffFilesStore((state) => state.setLoad);

  const result = useMemo(() => {
    const states = new Map<string, DeferredDiffLoad>();
    let changed = false;
    const next = files.map((file) => {
      const key = loadKey({ serverId, cwd, file, ignoreWhitespace });
      const load = key ? loads[key] : undefined;
      if (!load) return file;
      if (load.state !== DeferredDiffLoad.Loaded) {
        states.set(file.path, load.state);
        return file;
      }
      changed = true;
      return load.file;
    });
    return { files: changed ? next : files, loads: states };
  }, [cwd, files, ignoreWhitespace, loads, serverId]);

  const loadFile = useCallback(
    (path: string) => {
      const file = files.find((candidate) => candidate.path === path);
      const key = file && loadKey({ serverId, cwd, file, ignoreWhitespace });
      if (!client || !file?.deferred || !key) return;
      const current = useDeferredDiffFilesStore.getState().loads[key]?.state;
      if (current === DeferredDiffLoad.Loading || current === DeferredDiffLoad.Loaded) return;
      setLoad(key, { state: DeferredDiffLoad.Loading });
      void client
        .getCheckoutDiffFile({
          cwd,
          path,
          ...(file.oldPath ? { oldPath: file.oldPath } : {}),
          baseRef: file.deferred.baseRef,
          ...(file.targetRef ? { targetRef: file.targetRef } : {}),
          ...(ignoreWhitespace ? { ignoreWhitespace: true } : {}),
        })
        .then((loaded) => {
          setLoad(key, { state: DeferredDiffLoad.Loaded, file: displayedLoadedFile(file, loaded) });
          return undefined;
        })
        .catch((error: unknown) => {
          console.warn("[DeferredDiff] Failed to load file diff", error);
          setLoad(key, { state: DeferredDiffLoad.Failed });
        });
    },
    [client, cwd, files, ignoreWhitespace, serverId, setLoad],
  );

  return { files: result.files, loads: result.loads, loadFile };
}
