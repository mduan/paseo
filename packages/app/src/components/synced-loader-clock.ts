import { useLayoutEffect, useState } from "react";
import { makeMutable, type SharedValue, useSharedValue } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { getSyncedLoaderStep } from "@/components/synced-loader-state";

const sharedStep = makeMutable(0);
const activeLoaderCount = makeMutable(0);
const clockRunning = makeMutable(false);
let nextStepListenerId = 1;

function advanceSharedStep(): void {
  "worklet";
  if (activeLoaderCount.value === 0) {
    clockRunning.value = false;
    return;
  }

  const nextStep = getSyncedLoaderStep(Date.now());
  if (sharedStep.value !== nextStep) {
    sharedStep.value = nextStep;
  }
  requestAnimationFrame(advanceSharedStep);
}

function registerStepListener(
  step: SharedValue<number>,
  registered: SharedValue<boolean>,
  listenerId: number,
): void {
  "worklet";
  if (registered.value) {
    return;
  }

  registered.value = true;
  step.value = getSyncedLoaderStep(Date.now());
  sharedStep.addListener(listenerId, (nextStep) => {
    step.value = nextStep;
  });
  activeLoaderCount.value += 1;

  if (!clockRunning.value) {
    clockRunning.value = true;
    sharedStep.value = step.value;
    requestAnimationFrame(advanceSharedStep);
  }
}

function unregisterStepListener(registered: SharedValue<boolean>, listenerId: number): void {
  "worklet";
  if (!registered.value) {
    return;
  }

  registered.value = false;
  sharedStep.removeListener(listenerId);
  activeLoaderCount.value -= 1;
}

export function useSyncedLoaderStep(active: boolean, reduceMotion: boolean): SharedValue<number> {
  // The local value lets retained loaders detach from the app-wide clock without
  // unmounting their animated views or leaving hidden style worklets subscribed.
  const step = useSharedValue(reduceMotion ? 0 : getSyncedLoaderStep(Date.now()));
  const registered = useSharedValue(false);
  const [listenerId] = useState(() => nextStepListenerId++);

  useLayoutEffect(() => {
    if (!active || reduceMotion) {
      return;
    }

    scheduleOnUI(registerStepListener, step, registered, listenerId);
    return () => {
      scheduleOnUI(unregisterStepListener, registered, listenerId);
    };
  }, [active, listenerId, reduceMotion, registered, step]);

  return step;
}
