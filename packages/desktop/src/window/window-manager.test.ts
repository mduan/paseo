import { describe, expect, it, vi } from "vitest";
import { BrowserWindow, Menu, ipcMain } from "electron";
import { EventEmitter } from "node:events";

vi.mock("electron", () => ({
  BrowserWindow: class {
    webContents = Object.assign(new EventEmitter(), {
      copyImageAt: vi.fn(),
      downloadURL: vi.fn(),
      send: vi.fn(),
    });
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
  },
  ipcMain: { handle: vi.fn() },
}));

import {
  applyMacWindowControlsUpdate,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  getMainWindowChromeOptions,
  readBadgeCount,
  readWindowChromeUpdate,
  readWindowTheme,
  resolveWindowBounds,
  setupDefaultContextMenu,
  registerWindowManager,
} from "./window-manager";

describe("window-manager", () => {
  describe("setupDefaultContextMenu", () => {
    it("does not open a native menu outside inputs when no text is selected", () => {
      vi.mocked(Menu.buildFromTemplate).mockClear();
      const win = new BrowserWindow();
      setupDefaultContextMenu(win);

      win.webContents.emit("context-menu", {}, { isEditable: false, selectionText: "" });

      expect(Menu.buildFromTemplate).not.toHaveBeenCalled();
    });

    it("routes non-editable content to the app menu without a native popup", () => {
      vi.mocked(Menu.buildFromTemplate).mockClear();
      const win = new BrowserWindow();
      setupDefaultContextMenu(win);
      const params = {
        isEditable: false,
        x: 20,
        y: 30,
        selectionText: "Selected",
        linkURL: "https://example.com",
        srcURL: "",
        hasImageContents: false,
      };

      win.webContents.emit("context-menu", {}, params);

      expect(Menu.buildFromTemplate).not.toHaveBeenCalled();
      expect(win.webContents.send).toHaveBeenCalledWith("paseo:event:content-context-menu", {
        x: 20,
        y: 30,
        selectionText: "Selected",
        linkURL: "https://example.com",
        srcURL: "",
        hasImageContents: false,
      });
    });

    it("preserves the native editing menu for inputs", () => {
      vi.mocked(Menu.buildFromTemplate).mockClear();
      const win = new BrowserWindow();
      setupDefaultContextMenu(win);

      win.webContents.emit(
        "context-menu",
        {},
        {
          isEditable: true,
          editFlags: { canCut: true, canCopy: true, canPaste: true },
        },
      );

      expect(Menu.buildFromTemplate).toHaveBeenCalledWith([
        { role: "cut", enabled: true },
        { role: "copy", enabled: true },
        { role: "paste", enabled: true },
        { type: "separator" },
        { role: "selectAll" },
      ]);
      const menu = vi.mocked(Menu.buildFromTemplate).mock.results[0]!.value;
      expect(menu.popup).toHaveBeenCalledWith({ window: win });
    });

    it.each(["input-text", "text-area"])("keeps read-only %s inputs native", (formControlType) => {
      vi.mocked(Menu.buildFromTemplate).mockClear();
      const win = new BrowserWindow();
      setupDefaultContextMenu(win);

      win.webContents.emit(
        "context-menu",
        {},
        { isEditable: false, formControlType, selectionText: "Selected" },
      );

      expect(Menu.buildFromTemplate).toHaveBeenCalledWith([{ role: "copy" }]);
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  it("copies and saves only the requesting window's context-menu image", () => {
    vi.mocked(ipcMain.handle).mockClear();
    registerWindowManager({ mode: "native-mac" });
    const win = new BrowserWindow();
    const otherWin = new BrowserWindow();
    setupDefaultContextMenu(win);
    setupDefaultContextMenu(otherWin);
    win.webContents.emit(
      "context-menu",
      {},
      {
        isEditable: false,
        hasImageContents: true,
        srcURL: "https://example.com/image.png",
        x: 20,
        y: 30,
      },
    );
    otherWin.webContents.emit(
      "context-menu",
      {},
      {
        isEditable: false,
        hasImageContents: true,
        srcURL: "https://example.com/other.png",
        x: 80,
        y: 90,
      },
    );
    const copyImage = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === "paseo:menu:copyImage")![1];
    const saveImage = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === "paseo:menu:saveImage")![1];

    Reflect.apply(copyImage, undefined, [{ sender: win.webContents }]);
    Reflect.apply(saveImage, undefined, [{ sender: win.webContents }]);

    expect(win.webContents.copyImageAt).toHaveBeenCalledWith(20, 30);
    expect(win.webContents.downloadURL).toHaveBeenCalledWith("https://example.com/image.png");
    expect(otherWin.webContents.copyImageAt).not.toHaveBeenCalled();
    expect(otherWin.webContents.downloadURL).not.toHaveBeenCalled();
    const unrelated = new BrowserWindow();
    expect(() => Reflect.apply(copyImage, undefined, [{ sender: unrelated.webContents }])).toThrow(
      "The context menu does not contain an image.",
    );
  });

  describe("readBadgeCount", () => {
    it("returns valid non-negative integers", () => {
      expect(readBadgeCount(0)).toBe(0);
      expect(readBadgeCount(3)).toBe(3);
    });

    it("falls back to zero for invalid payloads", () => {
      expect(readBadgeCount(undefined)).toBe(0);
      expect(readBadgeCount(null)).toBe(0);
      expect(readBadgeCount(Number.NaN)).toBe(0);
      expect(readBadgeCount(Number.POSITIVE_INFINITY)).toBe(0);
      expect(readBadgeCount(-1)).toBe(0);
      expect(readBadgeCount(1.5)).toBe(0);
      expect(readBadgeCount("2")).toBe(0);
      expect(readBadgeCount({ count: 2 })).toBe(0);
    });
  });

  describe("readWindowTheme", () => {
    it("accepts supported title bar themes", () => {
      expect(readWindowTheme("light")).toBe("light");
      expect(readWindowTheme("dark")).toBe("dark");
    });

    it("rejects invalid title bar themes", () => {
      expect(readWindowTheme(undefined)).toBeNull();
      expect(readWindowTheme("auto")).toBeNull();
      expect(readWindowTheme("system")).toBeNull();
    });
  });

  describe("readWindowChromeUpdate", () => {
    it("accepts partial runtime overlay updates", () => {
      expect(
        readWindowChromeUpdate({
          backgroundColor: "#181B1A",
          trafficLightOffsetY: -5,
        }),
      ).toEqual({
        backgroundColor: "#181B1A",
        trafficLightOffsetY: -5,
      });
    });

    it("rejects empty and invalid payloads", () => {
      expect(readWindowChromeUpdate(undefined)).toBeNull();
      expect(readWindowChromeUpdate({})).toBeNull();
      expect(readWindowChromeUpdate({ backgroundColor: 12 })).toBeNull();
      expect(readWindowChromeUpdate({ trafficLightOffsetY: -11 })).toBeNull();
    });

    it("preserves fractional traffic-light offsets", () => {
      expect(readWindowChromeUpdate({ trafficLightOffsetY: 1.5 })).toEqual({
        trafficLightOffsetY: 1.5,
      });
    });
  });

  describe("applyMacWindowControlsUpdate", () => {
    it("uses the focus and normal traffic-light positions", () => {
      const setWindowButtonPosition = vi.fn();

      applyMacWindowControlsUpdate({
        win: { setWindowButtonPosition },
        update: { trafficLightOffsetY: -5 },
      });
      applyMacWindowControlsUpdate({
        win: { setWindowButtonPosition },
        update: { trafficLightOffsetY: 0.5 },
      });

      expect(setWindowButtonPosition).toHaveBeenNthCalledWith(1, { x: 16, y: 9 });
      expect(setWindowButtonPosition).toHaveBeenNthCalledWith(2, { x: 16, y: 14.5 });
    });
  });

  describe("getMainWindowChromeOptions", () => {
    it("uses renderer-painted controls on windows", () => {
      expect(
        getMainWindowChromeOptions({
          mode: "custom-windows",
        }),
      ).toEqual({
        frame: false,
        autoHideMenuBar: true,
      });
    });

    it("uses renderer-painted controls on linux", () => {
      expect(
        getMainWindowChromeOptions({
          mode: "custom-linux",
        }),
      ).toEqual({
        frame: false,
        autoHideMenuBar: true,
      });
    });

    it("keeps the mac traffic-light path separate", () => {
      expect(
        getMainWindowChromeOptions({
          mode: "native-mac",
        }),
      ).toEqual({
        titleBarStyle: "hidden",
        titleBarOverlay: true,
        trafficLightPosition: { x: 16, y: 14 },
      });
    });
  });

  describe("resolveWindowBounds", () => {
    it("falls back to the default size when no state is saved", () => {
      expect(resolveWindowBounds(null)).toEqual({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
      });
    });

    it("restores the full size and position", () => {
      expect(
        resolveWindowBounds({ x: 120, y: 80, width: 1024, height: 720, isMaximized: false }),
      ).toEqual({ width: 1024, height: 720, x: 120, y: 80 });
    });

    it("omits the position when only the size was persisted", () => {
      expect(resolveWindowBounds({ width: 1024, height: 720, isMaximized: true })).toEqual({
        width: 1024,
        height: 720,
      });
    });
  });
});
