import { useLayoutEffect } from "react";
import { type SharedValue, useSharedValue } from "react-native-reanimated";
import {
  getMsUntilNextSyncedLoaderStep,
  getSyncedLoaderStep,
} from "@/components/synced-loader-state";

// On web, a per-frame requestAnimationFrame loop keeps Chromium producing frames at the
// display rate (120Hz on ProMotion) for a glyph that changes six times per cycle. One
// timer that wakes on step boundaries lets the renderer and GPU idle between steps.
const steps = new Set<SharedValue<number>>();
let timer: ReturnType<typeof setTimeout> | undefined;

function tick(): void {
  const now = Date.now();
  const step = getSyncedLoaderStep(now);
  for (const value of steps) {
    value.value = step;
  }
  timer = setTimeout(tick, getMsUntilNextSyncedLoaderStep(now));
}

export function useSyncedLoaderStep(active: boolean, reduceMotion: boolean): SharedValue<number> {
  const step = useSharedValue(reduceMotion ? 0 : getSyncedLoaderStep(Date.now()));

  useLayoutEffect(() => {
    if (!active || reduceMotion) {
      return;
    }

    step.value = getSyncedLoaderStep(Date.now());
    steps.add(step);
    if (!timer) {
      timer = setTimeout(tick, getMsUntilNextSyncedLoaderStep(Date.now()));
    }
    return () => {
      steps.delete(step);
      if (steps.size === 0) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
  }, [active, reduceMotion, step]);

  return step;
}
