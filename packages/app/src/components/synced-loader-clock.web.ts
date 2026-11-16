import { useLayoutEffect } from "react";
import { type SharedValue, useSharedValue } from "react-native-reanimated";
import {
  getMsUntilNextSyncedLoaderStep,
  getSyncedLoaderStep,
} from "@/components/synced-loader-state";

// Step-boundary timer, not a rAF loop — rAF keeps Chromium rendering at display rate
// (120Hz on ProMotion) for a glyph that changes ~6 times a second.
const activeLoaderSteps = new Set<SharedValue<number>>();
let timer: ReturnType<typeof setTimeout> | undefined;

function tick(): void {
  const now = Date.now();
  const step = getSyncedLoaderStep(now);
  for (const loaderStep of activeLoaderSteps) {
    loaderStep.value = step;
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
    activeLoaderSteps.add(step);
    if (!timer) {
      timer = setTimeout(tick, getMsUntilNextSyncedLoaderStep(Date.now()));
    }
    return () => {
      activeLoaderSteps.delete(step);
      if (activeLoaderSteps.size === 0) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
  }, [active, reduceMotion, step]);

  return step;
}
