import { create } from "zustand";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";

export type WorkspaceTabMenuBuilder = (tabId: string) => WorkspaceTabMenuEntry[] | null;

/**
 * Tab menu actions (close with confirmation, rename modal, bulk close) live in a mounted
 * WorkspaceScreen. It publishes them here, keyed by layout persistence key, so the sidebar's
 * nested session rows can offer the same menu.
 */
export const useWorkspaceTabMenuRegistry = create<{
  builders: Record<string, WorkspaceTabMenuBuilder>;
}>(() => ({ builders: {} }));

export function registerWorkspaceTabMenuBuilder(key: string, builder: WorkspaceTabMenuBuilder) {
  useWorkspaceTabMenuRegistry.setState((state) => ({
    builders: { ...state.builders, [key]: builder },
  }));
  return () => {
    useWorkspaceTabMenuRegistry.setState((state) => {
      if (state.builders[key] !== builder) return state;
      const { [key]: _removed, ...builders } = state.builders;
      return { builders };
    });
  };
}
