import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test("loads the native terminal with an incomplete React Native navigator", async () => {
  vi.stubGlobal("navigator", { product: "ReactNative" });

  await import("./navigator");
  const { Terminal } = await import("@xterm/headless");
  const terminal = new Terminal({ cols: 80, rows: 24 });
  try {
    expect(terminal.cols).toBe(80);
    expect(terminal.rows).toBe(24);
  } finally {
    terminal.dispose();
  }
});
