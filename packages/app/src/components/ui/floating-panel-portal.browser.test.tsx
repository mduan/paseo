import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Portal, PortalProvider } from "@gorhom/portal";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FloatingPanelPortal,
  measureFloatingPanelPortalHost,
  useFloatingPanelPortalHostName,
} from "./floating-panel-portal";

const visibleWorkspaceStyle = {
  position: "absolute",
  left: 100,
  top: 200,
  width: 400,
  height: 300,
} as const;
const hiddenWorkspaceStyle = { display: "none" } as const;

let root: Root;
let container: HTMLDivElement;

function SkillMenu({ onMeasure }: { onMeasure: (rect: unknown) => void }) {
  const hostName = useFloatingPanelPortalHostName();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void measureFloatingPanelPortalHost(hostName).then(onMeasure);
    });
    return () => cancelAnimationFrame(frame);
  }, [hostName, onMeasure]);
  return (
    <Portal hostName={hostName}>
      <div data-testid="skill-menu">/code-review</div>
    </Portal>
  );
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps a skill menu in its visible workspace when another copy is retained", async () => {
  const onMeasure = vi.fn();
  act(() =>
    root.render(
      <PortalProvider>
        <div style={visibleWorkspaceStyle}>
          <FloatingPanelPortal>
            <SkillMenu onMeasure={onMeasure} />
          </FloatingPanelPortal>
        </div>
        <div style={hiddenWorkspaceStyle}>
          <FloatingPanelPortal>{null}</FloatingPanelPortal>
        </div>
      </PortalProvider>,
    ),
  );

  await vi.waitFor(() =>
    expect(onMeasure).toHaveBeenCalledWith({ x: 100, y: 200, width: 400, height: 300 }),
  );
  expect(container.querySelectorAll('[data-testid="skill-menu"]').length).toBe(1);
});
