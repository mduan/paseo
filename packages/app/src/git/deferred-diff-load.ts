import type { TFunction } from "i18next";
import { formatFileSize } from "@/utils/format-file-size";

export enum DeferredDiffLoad {
  Idle = "idle",
  Loading = "loading",
  Failed = "failed",
  Loaded = "loaded",
}

export function deferredDiffLoadLabel(t: TFunction) {
  return ({ size, load }: { size: number; load: DeferredDiffLoad }) => {
    if (load === DeferredDiffLoad.Loading) return t("workspace.git.diff.loadingDeferredFile");
    if (load === DeferredDiffLoad.Failed) return t("workspace.git.diff.deferredFileFailed");
    return t("workspace.git.diff.loadDeferredFile", { size: formatFileSize(size) });
  };
}
