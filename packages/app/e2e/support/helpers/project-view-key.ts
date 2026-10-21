export function projectPlacementViewKey(serverId: string, projectId: string): string {
  return JSON.stringify([serverId, projectId]);
}
