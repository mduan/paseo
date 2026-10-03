import { create } from "zustand";

/** A branch or base-ref switch the daemon has not answered yet, shown before it lands. */
export interface PendingCheckoutSwitch {
  branch?: string;
  baseRefLabel?: string;
}

interface PendingCheckoutSwitchState {
  byCheckout: Record<string, PendingCheckoutSwitch>;
}

const usePendingCheckoutSwitchStore = create<PendingCheckoutSwitchState>(() => ({
  byCheckout: {},
}));

function checkoutKey(serverId: string, cwd: string): string {
  return `${serverId}::${cwd}`;
}

/**
 * Runs a switch RPC with its target shown as pending. The daemon pushes the new status and
 * diff before it answers, so the pending state ends exactly when the real one is on screen.
 */
export async function withPendingCheckoutSwitch<T>(
  input: { serverId: string; cwd: string; pending: PendingCheckoutSwitch },
  run: () => Promise<T>,
): Promise<T> {
  const key = checkoutKey(input.serverId, input.cwd);
  usePendingCheckoutSwitchStore.setState((state) => ({
    byCheckout: { ...state.byCheckout, [key]: input.pending },
  }));
  try {
    return await run();
  } finally {
    usePendingCheckoutSwitchStore.setState((state) => {
      const { [key]: _done, ...rest } = state.byCheckout;
      return { byCheckout: rest };
    });
  }
}

export function usePendingCheckoutSwitch(
  serverId: string,
  cwd: string | null | undefined,
): PendingCheckoutSwitch | undefined {
  return usePendingCheckoutSwitchStore((state) =>
    cwd ? state.byCheckout[checkoutKey(serverId, cwd)] : undefined,
  );
}
