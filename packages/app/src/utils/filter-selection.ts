// Keep persisted empty arrays as “all”; null is an explicit empty selection.
export type FilterSelection = readonly string[] | null;

export function allFilterOptionsSelected({
  selection,
  options,
}: {
  selection: FilterSelection;
  options: readonly string[];
}): boolean {
  if (!selection) return false;
  return !selection.length || (options.length > 0 && options.every((id) => selection.includes(id)));
}

export function toggleFilterOption({
  selection,
  options,
  id,
}: {
  selection: FilterSelection;
  options: readonly string[];
  id: string;
}): string[] | null {
  const selected = selection?.length === 0 ? options : (selection ?? []);
  const next = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
  if (!next.length) return null;
  return options.length > 0 && options.every((value) => next.includes(value)) ? [] : next;
}
