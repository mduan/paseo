import { z } from "zod";

export const changesStateSchema = z
  .strictObject({
    // COMPAT(changesPaneState): fields persisted by v0.5.0-beta.3; remove after 2026-11-21. Preferences are global and mode selection is ephemeral.
    mode: z.enum(["uncommitted", "base"]).optional(),
    baseRef: z.string().optional(),
    layout: z.enum(["unified", "split"]).optional(),
    wrapLines: z.boolean().optional(),
    hideWhitespace: z.boolean().optional(),
    treeVisible: z.boolean(),
    treeWidth: z.number().optional(),
    collapsedFilePaths: z.array(z.string()),
    collapsedFolderPaths: z.array(z.string()),
    // COMPAT(changesCommitsSection): persisted before v0.11.0-fork.40 removed the Commits section; remove after 2027-05-13.
    commitsCollapsed: z.boolean().optional(),
  })
  .transform(
    ({
      mode: _mode,
      commitsCollapsed: _commitsCollapsed,
      baseRef: _baseRef,
      layout: _layout,
      wrapLines: _wrapLines,
      hideWhitespace: _hideWhitespace,
      ...paneState
    }) => paneState,
  );

export type ChangesState = z.infer<typeof changesStateSchema>;

export const defaultChangesState: ChangesState = {
  treeVisible: false,
  collapsedFilePaths: [],
  collapsedFolderPaths: [],
};
