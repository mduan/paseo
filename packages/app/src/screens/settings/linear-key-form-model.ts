/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
export type LinearKeyFormState = {
  apiKey: string;
  isVisible: boolean;
  canSubmit: boolean;
};

export function openLinearKeyForm() {
  const listeners = new Set<() => void>();
  let state: LinearKeyFormState = { apiKey: "", isVisible: false, canSubmit: false };
  function publish(next: Omit<LinearKeyFormState, "canSubmit">) {
    state = { ...next, canSubmit: Boolean(next.apiKey.trim()) };
    for (const listener of listeners) listener();
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setApiKey(apiKey: string) {
      publish({ ...state, apiKey });
    },
    toggleVisibility() {
      publish({ ...state, isVisible: !state.isVisible });
    },
    close() {
      state = { apiKey: "", isVisible: false, canSubmit: false };
      listeners.clear();
    },
  };
}
