import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

/**
 * The subset of a stored project filter that still names a project the sidebar can see.
 *
 * Empty means "all projects" — both when nothing is pinned and when everything pinned has gone
 * away. That second case is why nothing ever deletes a stored key: the project list is narrowed
 * by the host filter and is empty before any host connects, so absence does not mean the project
 * is gone. A filter goes inert while its host is away and comes back with it.
 * Null is an explicit empty selection and stays active even before hosts connect.
 *
 * This is the only definition of "is a project filter active". The menu's indicator, the
 * selection header and the per-row selection all read it, so they cannot disagree with what
 * the list is actually doing.
 */
export function resolveActiveProjectFilters(
  projectFilters: readonly string[] | null,
  availableViewKeys: ReadonlySet<string>,
): readonly string[] | null {
  if (!projectFilters) return null;
  if (projectFilters.length === 0) return EMPTY_PROJECT_FILTERS;
  const matching = projectFilters.filter((viewKey) => availableViewKeys.has(viewKey));
  return matching.length > 0 ? matching : EMPTY_PROJECT_FILTERS;
}

export function filterWorkspacesByProjects(input: {
  workspaces: readonly SidebarWorkspaceEntry[];
  projectFilters: readonly string[] | null;
}): SidebarWorkspaceEntry[] {
  const { workspaces, projectFilters } = input;
  if (!projectFilters) return [];
  if (projectFilters.length === 0) return [...workspaces];
  const included = new Set(projectFilters);
  return workspaces.filter((workspace) => included.has(workspace.projectViewKey));
}

const EMPTY_PROJECT_FILTERS: readonly string[] = [];
